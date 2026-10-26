/* eslint-disable no-empty-pattern -- This suite only drives the application under development. */
import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { defaultSettings } from '../../src/contracts'

test('real Electron windows and IPC: nonactivating feedback, stale results, busy saves, edit preservation and translation timeout', async ({}, info) => {
  const root = resolve('.cache/hotkey-perf-20261026/integration'); mkdirSync(root, { recursive: true })
  const profile = mkdtempSync(join(root, 'ui-')), db = new DatabaseSync(join(profile, 'captures.sqlite'))
  db.exec('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
  db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run('settings', JSON.stringify({ ...defaultSettings, shortcut: 'Control+Alt+D', autoLookup: false })); db.close()
  const app = await electron.launch({ args: [resolve('apps/desktop')], env: { ...process.env, POLAR_VOCAB_CAPTURE_DATA_DIR: profile } })
  try {
    const page = await app.firstWindow(); await expect(page.getByRole('heading', { name: 'Polar Vocab Capture' })).toBeVisible()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2)
    await expect.poll(async () => (await app.windows()).some(window => window.url() === 'polar://capture/feedback.html')).toBe(true)
    const feedback = (await app.windows()).find(window => window.url() === 'polar://capture/feedback.html')!
    await expect(feedback.getByRole('status')).toContainText('正在读取')
    const flags = await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'))!, hint = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/feedback.html'))!
      main.show(); main.focus(); const before = main.isFocused(); hint.showInactive()
      return { before, focusedAfter: main.isFocused(), hintFocusable: hint.isFocusable(), hintTop: hint.isAlwaysOnTop(), hintVisible: hint.isVisible() }
    })
    expect(flags).toEqual({ before: true, focusedAfter: true, hintFocusable: false, hintTop: true, hintVisible: true })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/feedback.html'))!.hide())
    const id = crypto.randomUUID(), old = crypto.randomUUID()
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === 'polar://capture/index.html')!.webContents.send('capture:progress', { id, phase: 'reading', repeated: true }), id)
    await expect(page.getByRole('button', { name: '新词', exact: true })).toBeDisabled()
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === 'polar://capture/index.html')!.webContents.send('capture:selection', { requestId: id, text: 'stale', method: 'uia', source: 'windows:fixture', reason: '人工结果' }), old)
    await expect(page.getByLabel('单词或短语', { exact: true })).toHaveValue('')
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === 'polar://capture/index.html')!.webContents.send('capture:selection', { requestId: id, text: 'example', method: 'uia', source: 'windows:fixture', reason: '人工结果' }), id)
    await expect(page.getByLabel('单词或短语', { exact: true })).toHaveValue('example')
    await expect(page.getByRole('button', { name: '收藏到生词队列', exact: true })).toBeEnabled()
    await page.getByLabel('中文释义 1', { exact: true }).fill('人工未保存编辑')
    const next = crypto.randomUUID()
    await app.evaluate(({ BrowserWindow }, id) => { const w = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === 'polar://capture/index.html')!; w.webContents.send('capture:progress', { id, phase: 'reading', repeated: false }); w.webContents.send('capture:selection', { requestId: id, text: 'new-word', method: 'uia', source: 'windows:fixture', reason: '人工结果' }) }, next)
    await expect(page.getByLabel('中文释义 1', { exact: true })).toHaveValue('人工未保存编辑')
    await expect(page.getByRole('button', { name: '切换到新选词' })).toBeVisible()
    await page.getByRole('button', { name: '保留当前编辑' }).click()
    // Deliberately stalled provider; existing real 10-second deadline, without a network request.
    await app.evaluate(({ net }) => { net.fetch = async (_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('fixture timeout')), { once: true })) })
    await page.getByRole('button', { name: '查询词典', exact: true }).click()
    await expect(page.getByRole('status').first()).toContainText('正在查询')
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === 'polar://capture/index.html')!.isVisible())).toBe(true)
    await expect(page.getByRole('status').first()).toContainText('词典及翻译未返回结果', { timeout: 25_000 })
    await expect(page.getByLabel('中文释义 1', { exact: true })).toHaveValue('人工未保存编辑')
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === 'polar://capture/index.html')!.isVisible())).toBe(true)
    await page.screenshot({ path: info.outputPath('timeout-window-stays-editable.png'), fullPage: true })
    const queue = await page.evaluate(() => window.polarCapture.queue({ search: '', state: 'all', offset: 0 })); expect(queue.ok && queue.value.total).toBe(0)
  } finally { await app.close() }
})
