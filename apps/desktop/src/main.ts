import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, protocol, screen, shell, Tray } from 'electron'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { canonicalJson, captureEventSchema, uuidSchema } from '../../../packages/shared'
import { CaptureQueue } from './queue'
import { CaptureUploader } from './uploader'
import { MyMemoryProvider } from './translation'
import { connectionInputSchema, desktopSettingsSchema, lookupCommandSchema, queueQuerySchema, saveCommandSchema, type DesktopStatus, type Reply, type SelectionResult } from './contracts'
import { popupBounds } from './window'

app.setName('Polar Vocab Capture')
if (process.env.POLAR_VOCAB_CAPTURE_DATA_DIR) { const data = resolve(process.env.POLAR_VOCAB_CAPTURE_DATA_DIR); mkdirSync(data, { recursive: true }); app.setPath('userData', data) }
protocol.registerSchemesAsPrivileged([{ scheme: 'polar', privileges: { secure: true, standard: true, supportFetchAPI: true } }])
const runFile = promisify(execFile), runtime = __dirname
let window: BrowserWindow | undefined, tray: Tray | undefined, queue: CaptureQueue, uploader: CaptureUploader
let quitting = false, reading = false, shortcutRegistered = false, failedAutomatic = 0
let lastAutomaticAttempt = 0
let captureWork: Promise<void> | undefined, autoTimer: ReturnType<typeof setTimeout> | undefined, interval: ReturnType<typeof setInterval> | undefined
const lookups = new Map<string, AbortController>()
const WEBSITE = 'https://polar0216.github.io/polar-vocab/'
const log = (code: string) => { void appendFile(join(app.getPath('userData'), 'logs', 'events.log'), new Date().toISOString() + ' ' + code + '\n').catch(() => undefined) }

function status(): DesktopStatus {
  const connection = queue.connection()
  return { settings: queue.settings(), deviceId: queue.deviceId, dataDirectory: app.getPath('userData'), shortcutRegistered, connected: uploader.connected(), target: connection ? `${connection.owner}/${connection.repository} · ${connection.branch}` : '', syncing: uploader.syncing, counts: queue.counts(), lastError: uploader.lastError }
}
function show(): void { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus() } }
function registerShortcut(value: string): boolean {
  const old = queue.settings().shortcut
  if (value === old && globalShortcut.isRegistered(value)) return true
  if (!globalShortcut.register(value, () => { if (!reading) captureWork = captureSelection() })) return false
  if (old !== value) globalShortcut.unregister(old)
  return true
}
async function captureSelection(): Promise<void> {
  if (reading || quitting) return
  reading = true
  let selection: SelectionResult = { text: '', method: 'manual', reason: '无法读取选区，请手动输入或粘贴。', source: 'windows' }
  try {
    const helper = app.isPackaged ? join(process.resourcesPath, 'SelectionHelper.exe') : join(runtime, 'native', 'SelectionHelper.exe')
    const result = await runFile(helper, queue.settings().clipboardFallback ? ['copy-fallback'] : [], { windowsHide: true, timeout: 7000, maxBuffer: 80_000, encoding: 'utf8' })
    selection = z.strictObject({ text: z.string().max(500), method: z.enum(['uia', 'clipboard', 'manual']), reason: z.string().max(500), source: z.string().max(200) }).parse(JSON.parse(result.stdout.trim()))
    log('selection-' + selection.method)
  } catch { log('selection-unavailable') }
  finally { reading = false }
  if (quitting) return
  const point = screen.getCursorScreenPoint(), bounds = popupBounds(point, screen.getDisplayNearestPoint(point).workArea)
  window?.setMinimumSize(Math.min(440, bounds.width), Math.min(520, bounds.height))
  window?.setBounds(bounds)
  show(); window?.webContents.send('capture:selection', selection)
}
function scheduleAutomatic(): void {
  clearTimeout(autoTimer)
  if (!queue.settings().autoSync || !uploader.connected() || failedAutomatic >= 3) return
  autoTimer = setTimeout(() => { void automatic() }, Math.max(15_000, lastAutomaticAttempt + 60_000 - Date.now()))
}
async function automatic(): Promise<void> {
  if (!queue.settings().autoSync || !uploader.connected() || uploader.syncing || failedAutomatic >= 3 || !net.isOnline() || Date.now() - lastAutomaticAttempt < 60_000) return
  const counts = queue.counts()
  if (counts.attention || !counts.pending && !counts.failed && !counts.uploading) return
  lastAutomaticAttempt = Date.now()
  try { await uploader.sync(); failedAutomatic = 0 } catch { failedAutomatic++; log('auto-upload-not-confirmed') }
}
function installIpc(): void {
  const invoke = <T>(name: string, work: (input: unknown) => T | Promise<T>) => ipcMain.handle('capture:' + name, async (event, input): Promise<Reply<T>> => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== 'polar://capture/index.html') return { ok: false, message: '请求来源不受信任。' }
    try { return { ok: true, value: await work(input) } }
    catch (error) { log('operation-' + name + '-failed'); return { ok: false, message: error instanceof z.ZodError ? '输入不合法，请检查字段和长度。' : ['lookup', 'connect', 'sync'].includes(name) && error instanceof Error ? error.message : name === 'save' ? '未能保存，编辑内容已保留。请检查磁盘空间、目录权限或重复事件身份。' : name === 'settings' ? '快捷键已被占用或设置未保存，请选择其他组合。' : '操作未完成，本机队列保留，请检查配置后重试。' } }
  })
  invoke('status', () => status())
  invoke('settings', (raw) => {
    const settings = desktopSettingsSchema.parse(raw), old = queue.settings()
    if (!registerShortcut(settings.shortcut)) throw new Error('快捷键被占用。')
    try { queue.setSettings(settings) } catch (error) { globalShortcut.unregister(settings.shortcut); shortcutRegistered = registerShortcut(old.shortcut); throw error }
    shortcutRegistered = true; failedAutomatic = 0; scheduleAutomatic(); return status()
  })
  invoke('lookup', async (raw) => {
    const command = lookupCommandSchema.parse(raw)
    if (lookups.size >= 3 || lookups.has(command.id)) throw new Error('翻译请求过多，请先取消或等待。')
    const controller = new AbortController(); lookups.set(command.id, controller)
    try { return await new MyMemoryProvider(net.fetch.bind(net) as typeof fetch).lookup(command.text, command.lang, controller.signal) }
    finally { lookups.delete(command.id) }
  })
  invoke('cancel-lookup', (id) => { uuidSchema.parse(id); lookups.get(id as string)?.abort(); return true })
  invoke('save', (raw) => {
    const command = saveCommandSchema.parse(raw), existing = queue.find(command.id)
    if (existing && canonicalJson(existing.payload) !== canonicalJson(command.payload)) throw new Error('不可变采集ID内容不同。')
    const event = existing ?? captureEventSchema.parse({ id: command.id, schemaVersion: 1, deviceId: queue.deviceId, capturedAt: new Date().toISOString(), origin: 'windows', payload: command.payload })
    const result = queue.save(event); failedAutomatic = 0; scheduleAutomatic(); return result
  })
  invoke('queue', (raw) => { const query = queueQuerySchema.parse(raw); return queue.list(query.search, query.state, query.offset) })
  invoke('connect', (raw) => uploader.test(connectionInputSchema.parse(raw)))
  invoke('confirm-connection', () => { const target = uploader.confirm(); failedAutomatic = 0; scheduleAutomatic(); return target })
  invoke('cancel-connection', () => { uploader.cancelPreview(); return true })
  invoke('disconnect', () => { uploader.disconnect(); clearTimeout(autoTimer); return true })
  invoke('sync', () => { failedAutomatic = 0; return uploader.sync() })
  invoke('retry', () => { queue.retry(); failedAutomatic = 0; return true })
  invoke('export', async () => {
    const output = await dialog.showSaveDialog(window!, { title: '导出完整采集队列（无Token）', defaultPath: 'polar-vocab-capture-queue-' + new Date().toISOString().slice(0, 10) + '.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (output.canceled || !output.filePath) return '已取消导出。'
    await writeFile(output.filePath, queue.export(), { encoding: 'utf8', flag: 'wx' })
    return '队列已导出。为保留已有备份，重名文件不会被覆盖。'
  })
  invoke('website', async () => { await shell.openExternal(WEBSITE); return true })
  invoke('hide', () => { for (const controller of lookups.values()) controller.abort(); window?.hide(); return true })
  invoke('quit', () => { app.quit(); return true })
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', show)
  app.on('before-quit', (event) => {
    if (reading && !quitting) { event.preventDefault(); quitting = true; void captureWork?.finally(() => app.quit()); return }
    quitting = true; globalShortcut.unregisterAll(); clearTimeout(autoTimer); clearInterval(interval)
    for (const controller of lookups.values()) controller.abort()
    uploader?.endSession(); tray?.destroy()
  })
  app.on('will-quit', () => { queue?.close() })
  app.on('window-all-closed', () => { /* Tray is the explicit background lifecycle. */ })
  void app.whenReady().then(async () => {
    try {
      await mkdir(join(app.getPath('userData'), 'logs'), { recursive: true })
      queue = new CaptureQueue(join(app.getPath('userData'), 'captures.sqlite'))
      uploader = new CaptureUploader(queue, net.fetch.bind(net) as typeof fetch)
      const rendererRoot = resolve(runtime, 'renderer')
      protocol.handle('polar', async (request) => {
        try {
          const url = new URL(request.url), path = resolve(rendererRoot, '.' + decodeURIComponent(url.pathname))
          if (url.host !== 'capture' || !path.startsWith(rendererRoot + sep) || !['.html', '.js', '.css', '.png', '.svg'].includes(extname(path))) return new Response(null, { status: 403 })
          const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }
          return new Response(await readFile(path), { headers: { 'Content-Type': types[extname(path)], 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } })
        } catch { return new Response(null, { status: 404 }) }
      })
      const cursor = screen.getCursorScreenPoint(), initialBounds = popupBounds(cursor, screen.getDisplayNearestPoint(cursor).workArea)
      window = new BrowserWindow({ ...initialBounds, minWidth: Math.min(440, initialBounds.width), minHeight: Math.min(520, initialBounds.height), title: 'Polar Vocab Capture', backgroundColor: '#f4f7f5', icon: join(runtime, 'icon.png'), show: false,
        webPreferences: { preload: join(runtime, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false } })
      Menu.setApplicationMenu(null)
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      window.webContents.session.setPermissionCheckHandler(() => false)
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', (event) => event.preventDefault())
      window.on('close', (event) => { if (!quitting) { event.preventDefault(); window?.hide() } })
      tray = new Tray(nativeImage.createFromPath(join(runtime, 'icon.png')).resize({ width: 20, height: 20 }))
      tray.setToolTip('Polar Vocab Capture · 划词收集')
      tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开查词 / 队列 / 设置', click: show }, { label: '打开 Polar Vocab 网站', click: () => { void shell.openExternal(WEBSITE) } }, { type: 'separator' }, { label: '退出（释放快捷键）', click: () => app.quit() }]))
      tray.on('double-click', show)
      installIpc()
      shortcutRegistered = registerShortcut(queue.settings().shortcut)
      await window.loadURL('polar://capture/index.html'); show()
      log('startup-ready')
      if (!shortcutRegistered) { log('shortcut-conflict'); await dialog.showMessageBox(window, { type: 'warning', title: '快捷键注册失败', message: '默认快捷键已被其他软件占用，请在设置中选择其他组合。程序仍可手动查词。' }) }
      interval = setInterval(() => { void automatic() }, 60_000)
      window.on('focus', () => { failedAutomatic = 0; scheduleAutomatic() })
    } catch { log('startup-failed'); await dialog.showMessageBox({ type: 'error', title: 'Polar Vocab Capture 无法启动', message: '本地队列或运行环境不可用。原文件未清空，请检查目录权限、磁盘空间和.NET Framework，然后查看固定分类日志。' }); app.quit() }
  })
}
