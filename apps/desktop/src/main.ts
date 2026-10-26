import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, protocol, screen, shell, Tray } from 'electron'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { prepareDataDirectory, importIntoEmptyDataDirectory, defaultDataDirectory, MigrationError, type PreparedDataDirectory } from './migration'
import { AuthorizationController } from './authorization'
import { WindowsCredentialVault } from './credentials'
import { WebCompatibility } from './web-compatibility'
import { SentenceTranslator } from './sentence'
import { extname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { canonicalJson, captureEventSchema, uuidSchema } from '../../../packages/shared'
import { CaptureQueue } from './queue'
import { CaptureUploader } from './uploader'
import { MyMemoryProvider } from './translation'
import { DictionaryLookup, WiktApiProvider } from './dictionary'
import { connectionTargetSchema, desktopSettingsSchema, lookupCommandSchema, sentenceCommandSchema, queueQuerySchema, saveCommandSchema, type DesktopStatus, type Reply } from './contracts'
import { popupBounds } from './window'
import { SelectionReader, type SelectionOutcome } from './selection'
import { CaptureFlow } from './capture-flow'
import { capturePerformanceSchema, queryPerformanceSchema } from './performance'

app.setName('Polar Vocab Capture')
const appDataRoot = app.getPath('appData')
const selectedDataDirectory = process.env.POLAR_VOCAB_CAPTURE_DATA_DIR ? resolve(process.env.POLAR_VOCAB_CAPTURE_DATA_DIR) : defaultDataDirectory(appDataRoot)
// Chromium can create caches before our async SQLite backup completes (including
// before the first BrowserWindow). Keep those writes outside the migration target.
const runtimeDataDirectory = selectedDataDirectory + '.runtime'
mkdirSync(runtimeDataDirectory, { recursive: true }); app.setPath('userData', runtimeDataDirectory)
protocol.registerSchemesAsPrivileged([{ scheme: 'polar', privileges: { secure: true, standard: true, supportFetchAPI: true } }])
const runtime = __dirname
let window: BrowserWindow | undefined, feedbackWindow: BrowserWindow | undefined, tray: Tray | undefined, queue: CaptureQueue, uploader: CaptureUploader, authorization: AuthorizationController, prepared: PreparedDataDirectory
let queueOpen = false
let quitting = false, shortcutRegistered = false, failedAutomatic = 0
let selectionReader: SelectionReader | undefined, captureFlow: CaptureFlow | undefined
let initialCapturePending = false
let awaitingSelectionPaint: string | undefined
let rendererReady: () => void
const rendererInitialized = new Promise<void>(resolve => { rendererReady = resolve })
const captureTimings = new Map<string, { started: number; outcome?: SelectionOutcome; repeated: boolean; logged: Set<string> }>()
let lastAutomaticAttempt = 0
let autoTimer: ReturnType<typeof setTimeout> | undefined, interval: ReturnType<typeof setInterval> | undefined
const lookups = new Map<string, AbortController>()
const dictionaryLookup = new DictionaryLookup(new WiktApiProvider((...args) => (net.fetch as typeof fetch)(...args)), new MyMemoryProvider((...args) => (net.fetch as typeof fetch)(...args)))
const sentenceTranslator = new SentenceTranslator(new MyMemoryProvider((...args) => (net.fetch as typeof fetch)(...args)))
const webCompatibility = new WebCompatibility((...args) => (net.fetch as typeof fetch)(...args))
let authorizationRetryAt = 0, importing = false
const WEBSITE = 'https://polar0216.github.io/polar-vocab/'
const log = (code: string) => { void appendFile(join(selectedDataDirectory, 'logs', 'events.log'), new Date().toISOString() + ' ' + code + '\n').catch(() => undefined) }

function status(): DesktopStatus {
  const connection = queue.connection()
  return { settings: queue.settings(), deviceId: queue.deviceId, dataDirectory: selectedDataDirectory, shortcutRegistered, connected: uploader.connected(), target: connection ? `${connection.owner}/${connection.repository} · ${connection.branch}` : '', syncing: uploader.syncing, counts: queue.counts(), lastError: uploader.lastError, version: app.getVersion(), authorization: authorization.status(), web: webCompatibility.status(), migration: { action: prepared.action, ...(prepared.migration ? { backupDirectory: prepared.migration.backupDirectory } : {}) } }
}
function show(): void { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus() } }
function dismissCapture(): void {
  awaitingSelectionPaint = undefined
  captureFlow?.dismiss(); feedbackWindow?.hide()
  window?.webContents.send('capture:progress', { id: randomUUID(), phase: 'cancelled', repeated: false })
}
function openManually(): void { dismissCapture(); show() }
function performanceLog(id: string, stage: 'feedback-show' | 'feedback-paint' | 'selection-ready' | 'selection-paint' | 'discarded'): void {
  const timing = captureTimings.get(id); if (!timing) return
  if (timing.logged.has(stage)) return
  timing.logged.add(stage)
  const outcome = timing.outcome
  const record = capturePerformanceSchema.parse({ schemaVersion: 1, at: new Date().toISOString(), requestId: id, stage, elapsedMs: Math.min(120_000, Math.round(performance.now() - timing.started)), sourceCategory: outcome?.sourceCategory ?? 'unknown', result: outcome?.selection.method ?? (timing.repeated ? 'busy' : 'reading'), failure: outcome?.failure ?? 'none', ...(outcome?.stages ? { native: outcome.stages } : {}) })
  void appendFile(join(selectedDataDirectory, 'logs', 'performance.jsonl'), JSON.stringify(record) + '\n').catch(() => undefined)
}
function queryPerformance(command: { id: string; captureId?: string }, stage: 'dictionary-ready' | 'translation-ready' | 'sentence-translation-ready', started: number, result: 'success' | 'partial' | 'failed'): void {
  const record = queryPerformanceSchema.parse({ schemaVersion: 1, at: new Date().toISOString(), requestId: command.id, ...(command.captureId ? { captureId: command.captureId } : {}), stage, elapsedMs: Math.min(120_000, Math.round(performance.now() - started)), result })
  void appendFile(join(selectedDataDirectory, 'logs', 'query-performance.jsonl'), JSON.stringify(record) + '\n').catch(() => undefined)
}
function registerShortcut(value: string): boolean {
  const old = queue.settings().shortcut
  if (value === old && globalShortcut.isRegistered(value)) return true
  if (!globalShortcut.register(value, captureSelection)) return false
  if (old !== value) globalShortcut.unregister(old)
  return true
}
export function captureSelection(): void {
  if (quitting || importing) return
  if (captureFlow) captureFlow.trigger()
  else initialCapturePending = true
}
function initializeCapture(): void {
  const helper = app.isPackaged ? join(process.resourcesPath, 'SelectionHelper.exe') : join(runtime, 'native', 'SelectionHelper.exe')
  selectionReader = new SelectionReader(helper, log); selectionReader.warm()
  captureFlow = new CaptureFlow({
    feedback: (id, repeated) => {
      awaitingSelectionPaint = id
      captureTimings.set(id, { started: performance.now(), repeated, logged: new Set() })
      if (captureTimings.size > 64) captureTimings.delete(captureTimings.keys().next().value!)
      const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
      feedbackWindow?.setBounds({ x: area.x + Math.max(0, area.width - 376), y: area.y + Math.max(0, area.height - 124), width: Math.min(360, area.width), height: Math.min(108, area.height) })
      feedbackWindow?.webContents.send('capture:feedback', { id, repeated })
      feedbackWindow?.setAlwaysOnTop(true, 'screen-saver')
      feedbackWindow?.showInactive(); performanceLog(id, 'feedback-show')
      window?.webContents.send('capture:progress', { id, phase: 'reading', repeated })
    },
    read: id => selectionReader!.read(id, queue.settings().clipboardFallback, queue.settings().shortcut),
    cancel: id => selectionReader?.cancel(id),
    complete: (id, outcome) => {
      if (quitting) return
      captureTimings.get(id)!.outcome = outcome; performanceLog(id, 'selection-ready')
      feedbackWindow?.hide()
      const point = screen.getCursorScreenPoint(), bounds = popupBounds(point, screen.getDisplayNearestPoint(point).workArea)
      window?.setMinimumSize(Math.min(440, bounds.width), Math.min(520, bounds.height)); window?.setBounds(bounds)
      if (outcome.failure === 'focus-changed') { window?.showInactive(); window?.flashFrame(true) } else show()
      window?.webContents.send('capture:selection', { ...outcome.selection, requestId: id }); log('selection-' + outcome.selection.method)
    },
    discarded: (id, outcome) => { const timing = captureTimings.get(id); if (timing) { timing.outcome = outcome; performanceLog(id, 'discarded'); captureTimings.delete(id) } },
  })
}
function scheduleAutomatic(): void {
  if (quitting || importing || !queueOpen) return
  clearTimeout(autoTimer)
  if (!queue.settings().autoSync || !uploader.connected() || failedAutomatic >= 3) return
  autoTimer = setTimeout(() => { void automatic() }, Math.max(15_000, lastAutomaticAttempt + 60_000 - Date.now()))
}
async function retryAuthorization(): Promise<void> {
  if (quitting || importing || !net.isOnline() || Date.now() < authorizationRetryAt || !['offline', 'disconnected', 'error'].includes(authorization.status().state)) return
  authorizationRetryAt = Date.now() + 60_000; await authorization.restore(); scheduleAutomatic()
}
async function automatic(): Promise<void> {
  if (quitting || importing || !queueOpen) return
  if (!queue.settings().autoSync || !uploader.connected() || uploader.syncing || failedAutomatic >= 3 || !net.isOnline() || Date.now() - lastAutomaticAttempt < 60_000) return
  const counts = queue.counts()
  if (counts.attention || !counts.pending && !counts.failed && !counts.uploading) return
  lastAutomaticAttempt = Date.now()
  try { await webCompatibility.require(); if (quitting || importing || !queueOpen) return; await authorization.sync(); failedAutomatic = 0 } catch { failedAutomatic++; log('auto-upload-not-confirmed') }
}
function installIpc(): void {
  ipcMain.on('capture:feedback-painted', (event, id) => {
    if (feedbackWindow && event.sender === feedbackWindow.webContents && event.senderFrame === feedbackWindow.webContents.mainFrame && event.senderFrame.url === 'polar://capture/feedback.html' && uuidSchema.safeParse(id).success) performanceLog(id, 'feedback-paint')
  })
  ipcMain.on('capture:selection-painted', (event, id) => {
    if (window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === 'polar://capture/index.html' && uuidSchema.safeParse(id).success) {
      performanceLog(id, 'selection-paint')
      if (awaitingSelectionPaint === id) awaitingSelectionPaint = undefined
    }
  })
  const invoke = <T>(name: string, work: (input: unknown) => T | Promise<T>) => ipcMain.handle('capture:' + name, async (event, input): Promise<Reply<T>> => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== 'polar://capture/index.html') return { ok: false, message: '请求来源不受信任。' }
    try { return { ok: true, value: await work(input) } }
    catch (error) { log('operation-' + name + '-failed'); return { ok: false, message: error instanceof z.ZodError ? '输入不合法，请检查字段和长度。' : ['lookup', 'translate', 'sentence', 'connect', 'sync', 'confirm-connection', 'restore-authorization', 'import-old-queue'].includes(name) && error instanceof Error ? error.message : name === 'save' ? '未能保存，编辑内容已保留。请检查磁盘空间、目录权限或重复事件身份。' : name === 'settings' ? '快捷键已被占用或设置未保存，请选择其他组合。' : '操作未完成，本机队列保留，请检查配置后重试。' } }
  })
  invoke('status', () => { rendererReady(); return status() })
  invoke('settings', (raw) => {
    const settings = desktopSettingsSchema.parse(raw), old = queue.settings()
    if (!registerShortcut(settings.shortcut)) throw new Error('快捷键被占用。')
    try { queue.setSettings(settings); if (!settings.onlineLookup) for (const controller of lookups.values()) controller.abort() } catch (error) { globalShortcut.unregister(settings.shortcut); shortcutRegistered = registerShortcut(old.shortcut); throw error }
    shortcutRegistered = true; failedAutomatic = 0; scheduleAutomatic(); return status()
  })
  invoke('lookup', async (raw) => {
    const command = lookupCommandSchema.parse(raw)
    if (!queue.settings().onlineLookup) throw new Error('当前仅本机手动模式，未向外部服务发送文字。')
    if (lookups.size >= 3 || lookups.has(command.id)) throw new Error('翻译请求过多，请先取消或等待。')
    const controller = new AbortController(); lookups.set(command.id, controller)
    const started = performance.now(); let dictionaryLogged = false
    try { const result = await dictionaryLookup.lookup(command.text, command.lang, controller.signal, result => { if (!controller.signal.aborted) { if (!dictionaryLogged) { queryPerformance(command, 'dictionary-ready', started, 'success'); dictionaryLogged = true }; window?.webContents.send('capture:lookup-progress', { id: command.id, result }) } }); queryPerformance(command, 'translation-ready', started, result.warnings.length ? 'partial' : 'success'); return result }
    catch (error) { queryPerformance(command, dictionaryLogged ? 'translation-ready' : 'dictionary-ready', started, 'failed'); throw error }
    finally { lookups.delete(command.id) }
  })
  invoke('translate', async raw => {
    const command = lookupCommandSchema.parse(raw)
    if (!queue.settings().onlineLookup) throw new Error('当前仅本机手动模式，未向外部服务发送文字。')
    if (lookups.size >= 3 || lookups.has(command.id)) throw new Error('翻译请求过多，请先取消或等待。')
    const controller = new AbortController(); lookups.set(command.id, controller)
    try { return await new MyMemoryProvider((...args) => (net.fetch as typeof fetch)(...args)).lookup(command.text, command.lang, controller.signal) }
    finally { lookups.delete(command.id) }
  })
  invoke('sentence', async raw => {
    const command = sentenceCommandSchema.parse(raw)
    if (!queue.settings().onlineLookup) throw new Error('当前仅本机手动模式，未向外部服务发送文字。')
    if (lookups.size >= 3 || lookups.has(command.id)) throw new Error('已有查询正在处理，请先取消或等待。')
    const controller = new AbortController(); lookups.set(command.id, controller)
    const started = performance.now()
    try { const result = await sentenceTranslator.translate(command.text, command.lang, controller.signal, result => { if (!controller.signal.aborted) window?.webContents.send('capture:sentence-progress', { id: command.id, result }) }); queryPerformance(command, 'sentence-translation-ready', started, result.complete ? 'success' : 'partial'); return result }
    catch (error) { queryPerformance(command, 'sentence-translation-ready', started, 'failed'); throw error }
    finally { lookups.delete(command.id) }
  })
  invoke('cancel-lookup', (id) => { uuidSchema.parse(id); lookups.get(id as string)?.abort(); return true })
  invoke('save', (raw) => {
    if (captureFlow?.reading || awaitingSelectionPaint) throw new Error('选区读取中，暂不收藏旧内容。')
    const command = saveCommandSchema.parse(raw), existing = queue.find(command.id)
    if (existing && canonicalJson(existing.payload) !== canonicalJson(command.payload)) throw new Error('不可变采集ID内容不同。')
    const event = existing ?? captureEventSchema.parse({ id: command.id, schemaVersion: 1, deviceId: queue.deviceId, capturedAt: new Date().toISOString(), origin: 'windows', payload: command.payload })
    const result = queue.save(event); failedAutomatic = 0; scheduleAutomatic(); return result
  })
  invoke('queue', (raw) => { const query = queueQuerySchema.parse(raw); return queue.list(query.search, query.state, query.offset) })
  invoke('connect', async raw => { const target = connectionTargetSchema.parse(raw), token = await authorization.prompt(target); if (!token) return ''; return authorization.preflight({ ...target, token }) })
  invoke('confirm-connection', async raw => { const options = z.strictObject({ remember: z.boolean() }).parse(raw ?? { remember: false }); const target = await authorization.confirm(options); failedAutomatic = 0; scheduleAutomatic(); return target })
  invoke('cancel-connection', () => { authorization.cancelPreview(); return true })
  invoke('disconnect', async () => { await authorization.disconnect(); clearTimeout(autoTimer); return true })
  invoke('restore-authorization', async () => { authorizationRetryAt = Date.now() + 60_000; await authorization.restore(); scheduleAutomatic(); return true })
  invoke('verify-website', () => webCompatibility.verify())
  invoke('sync', async () => { failedAutomatic = 0; await webCompatibility.require(); if (quitting || importing || !queueOpen) throw new Error('应用生命周期已变化，本机队列保留。'); return authorization.sync() })
  invoke('import-old-queue', async () => {
    if (uploader.syncing || importing || Object.values(queue.counts()).some(count => count > 0)) throw new Error('只有空队列且没有上传时可迁入旧目录；原数据保留，不会混并设备。')
    const selection = await dialog.showOpenDialog(window!, { title: '选择旧版 captures.sqlite 所在文件夹（原目录只读保留）', properties: ['openDirectory'] })
    if (selection.canceled || !selection.filePaths[0]) return '已取消，原队列未修改。'
    const answer = await dialog.showMessageBox(window!, { type: 'question', buttons: ['取消', '备份并迁入'], defaultId: 0, cancelId: 0, title: '确认迁移旧队列', message: '将只读备份所选旧队列，并迁入当前空库。原目录及旧程序保留，可回滚；本次连接及其记住凭证会清除，新库需要重新授权。' })
    if (answer.response !== 1) return '已取消迁移。'
    if (uploader.syncing || importing || Object.values(queue.counts()).some(count => count > 0)) throw new Error('确认期间队列或同步状态已变化，未迁移；原数据保留。')
    await authorization.disconnect()
    if (uploader.syncing || importing || Object.values(queue.counts()).some(count => count > 0)) throw new Error('队列状态已变化，未迁移。')
    importing = true; dismissCapture(); clearTimeout(autoTimer); clearInterval(interval); globalShortcut.unregisterAll(); selectionReader?.stop(); for (const controller of lookups.values()) controller.abort(); authorization.endSession(); queue.close(); queueOpen = false
    try { await importIntoEmptyDataDirectory(prepared.dataDirectory, selection.filePaths[0]); app.relaunch(); app.quit(); return '迁移完成，正在重启。' }
    catch (error) {
      try {
        prepared = await prepareDataDirectory(appDataRoot, { dataDirectory: selectedDataDirectory })
        queue = new CaptureQueue(prepared.databasePath); queueOpen = true; uploader = new CaptureUploader(queue, (...args) => (net.fetch as typeof fetch)(...args))
        authorization = new AuthorizationController(queue, uploader, new WindowsCredentialVault(app.isPackaged ? join(process.resourcesPath, 'CredentialHelper.exe') : join(runtime, 'native', 'CredentialHelper.exe')))
        importing = false; shortcutRegistered = registerShortcut(queue.settings().shortcut); initializeCapture(); interval = setInterval(() => { void retryAuthorization().then(automatic).catch(() => log('authorization-retry-stopped')) }, 60_000)
      } catch {
        await dialog.showMessageBox(window!, { type: 'error', title: '迁移恢复未完成', message: '无法安全重开队列，应用将停止。原目录、备份与恢复日志均保留；请勿清库重建。' }); app.quit()
      }
      throw error
    }
  })
  invoke('retry', () => { queue.retry(); failedAutomatic = 0; return true })
  invoke('export', async () => {
    const output = await dialog.showSaveDialog(window!, { title: '导出完整采集队列（无Token）', defaultPath: 'polar-vocab-capture-queue-' + new Date().toISOString().slice(0, 10) + '.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (output.canceled || !output.filePath) return '已取消导出。'
    await writeFile(output.filePath, queue.export(), { encoding: 'utf8', flag: 'wx' })
    return '队列已导出。为保留已有备份，重名文件不会被覆盖。'
  })
  invoke('website', async () => { await shell.openExternal(WEBSITE); return true })
  invoke('hide', () => { dismissCapture(); for (const controller of lookups.values()) controller.abort(); window?.hide(); return true })
  invoke('quit', () => { app.quit(); return true })
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  const preparation = prepareDataDirectory(appDataRoot, process.env.POLAR_VOCAB_CAPTURE_DATA_DIR ? { dataDirectory: selectedDataDirectory } : {}).then(value => ({ value }), error => ({ error }))
  app.on('second-instance', openManually)
  app.on('before-quit', () => {
    quitting = true; globalShortcut.unregisterAll(); clearTimeout(autoTimer); clearInterval(interval)
    dismissCapture(); selectionReader?.stop()
    for (const controller of lookups.values()) controller.abort()
    authorization?.endSession(); uploader?.endSession(); tray?.destroy()
  })
  app.on('will-quit', () => { if (queueOpen) { queue.close(); queueOpen = false } })
  app.on('window-all-closed', () => { /* Tray is the explicit background lifecycle. */ })
  void app.whenReady().then(async () => {
    try {
      const result = await preparation; if ('error' in result) throw result.error; prepared = result.value
      await mkdir(join(selectedDataDirectory, 'logs'), { recursive: true })
      queue = new CaptureQueue(prepared.databasePath); queueOpen = true
      uploader = new CaptureUploader(queue, (...args) => (net.fetch as typeof fetch)(...args))
      authorization = new AuthorizationController(queue, uploader, new WindowsCredentialVault(app.isPackaged ? join(process.resourcesPath, 'CredentialHelper.exe') : join(runtime, 'native', 'CredentialHelper.exe')))
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
      window.on('close', (event) => { if (!quitting) { event.preventDefault(); dismissCapture(); window?.hide() } })
      tray = new Tray(nativeImage.createFromPath(join(runtime, 'icon.png')).resize({ width: 20, height: 20 }))
      tray.setToolTip('Polar Vocab Capture · 划词收集')
      tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开查词', click: () => { openManually(); window?.webContents.send('capture:navigate', 'lookup') } }, { label: '查看待同步队列', click: () => { openManually(); window?.webContents.send('capture:navigate', 'queue') } }, { label: '修改快捷键与设置', click: () => { openManually(); window?.webContents.send('capture:navigate', 'settings') } }, { label: '手动同步', click: () => { void webCompatibility.require().then(() => { if (quitting || importing || !queueOpen) return; return authorization.sync() }).catch(() => { log('tray-sync-not-confirmed'); openManually(); window?.webContents.send('capture:navigate', 'queue') }) } }, { label: '打开 Polar Vocab 网站', click: () => { void shell.openExternal(WEBSITE) } }, { type: 'separator' }, { label: '退出（释放快捷键）', click: () => app.quit() }]))
      tray.on('double-click', openManually)
      installIpc()
      shortcutRegistered = registerShortcut(queue.settings().shortcut)
      await window.loadURL('polar://capture/index.html')
      feedbackWindow = new BrowserWindow({ width: 360, height: 108, show: false, frame: false, focusable: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, minimizable: false, maximizable: false, backgroundColor: '#f4f7f5', title: 'Polar Vocab · 正在取词', webPreferences: { preload: join(runtime, 'feedback-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
      feedbackWindow.setIgnoreMouseEvents(true)
      feedbackWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      feedbackWindow.webContents.on('will-navigate', event => event.preventDefault())
      await feedbackWindow.loadURL('polar://capture/feedback.html')
      feedbackWindow.setAlwaysOnTop(true, 'screen-saver')
      // React requests status after mounting its IPC listeners. Do not lose the first result during startup.
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Renderer initialization timed out')), 5000)
        void rendererInitialized.then(() => { clearTimeout(timeout); resolve() })
      })
      initializeCapture()
      if (initialCapturePending) { initialCapturePending = false; captureSelection() } else show()
      log('startup-ready')
      if (!shortcutRegistered) log('shortcut-conflict')
      interval = setInterval(() => { void retryAuthorization().then(automatic).catch(() => log('authorization-retry-stopped')) }, 60_000)
      window.on('focus', () => { failedAutomatic = 0; void retryAuthorization(); scheduleAutomatic() })
      void webCompatibility.verify(); void authorization.restore().then(scheduleAutomatic).catch(() => log('authorization-restore-stopped'))
    } catch (error) { log('startup-failed'); await dialog.showMessageBox({ type: 'error', title: 'Polar Vocab Capture 无法启动', message: error instanceof MigrationError ? error.message + ' 原队列和备份保留，请勿删除或重建。' : '本地队列或运行环境不可用。原文件未清空，请检查目录权限、磁盘空间和.NET Framework，然后查看固定分类日志。' }); app.quit() }
  })
}
