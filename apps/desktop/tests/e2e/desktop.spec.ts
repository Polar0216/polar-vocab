/* eslint-disable no-empty-pattern -- Electron tests launch their own application, without browser fixtures. */
import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { defaultSettings } from '../../src/contracts'

const root = resolve('.cache/phase4-real-desktop/e2e'); mkdirSync(root, { recursive: true })
const launch = (profile: string, shortcut?: string) => {
  if (shortcut) {
    const db = new DatabaseSync(join(profile, 'captures.sqlite'))
    db.exec('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL)')
    db.prepare('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)').run('settings', JSON.stringify({ ...defaultSettings, shortcut }))
    db.close()
  }
  return electron.launch({ args: [resolve('apps/desktop')], env: { ...process.env, POLAR_VOCAB_CAPTURE_DATA_DIR: profile } })
}
test('real Windows Electron runtime: isolated IPC, explicit saves, SQLite faults, close/reopen and shortcut lifecycle', async ({}, info) => {
  const profile = mkdtempSync(join(root, 'ui-'))
  let app = await launch(profile, 'Control+Alt+D')
  try {
    let page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: 'Polar Vocab Capture' })).toBeVisible()
    expect(await page.evaluate(() => ({ node: typeof (globalThis as Record<string, unknown>).require, process: typeof (globalThis as Record<string, unknown>).process, keys: Object.keys(window.polarCapture) }))).toMatchObject({ node: 'undefined', process: 'undefined' })
    expect(await app.evaluate(({ BrowserWindow }) => { const contents = BrowserWindow.getAllWindows()[0].webContents as unknown as { getLastWebPreferences(): { contextIsolation: boolean; sandbox: boolean; nodeIntegration: boolean } }; const p = contents.getLastWebPreferences(); return { isolated: p.contextIsolation, sandbox: p.sandbox, node: p.nodeIntegration } })).toEqual({ isolated: true, sandbox: true, node: false })
    expect(await page.evaluate(async () => (await window.polarCapture.status()).ok)).toBe(true)
    expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Alt+D'))).toBe(true)
    await page.getByLabel('单词或短语', { exact: true }).fill('artificial-desktop-persist')
    await page.getByLabel('中文释义', { exact: true }).fill('人工测试，离线收藏')
    await page.getByRole('button', { name: '将当前原文作为原句' }).click()
    await page.getByLabel('单词或短语', { exact: true }).press('Enter')
    await expect(page.getByRole('button', { name: '已收藏到本机', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '本地队列', exact: true }).click()
    await expect(page.getByText('artificial-desktop-persist', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '查词与收藏', exact: true }).click()
    await page.getByRole('button', { name: '新词', exact: true }).click()
    await page.getByLabel('查询语言').selectOption('de')
    await page.getByLabel('单词或短语', { exact: true }).fill('Prüfwort')
    await page.getByLabel('德语冠词').selectOption('das')
    await page.getByLabel('德语复数').fill('Prüfwörter')
    const fault = new DatabaseSync(join(profile, 'captures.sqlite'))
    fault.exec("CREATE TRIGGER test_save BEFORE INSERT ON captures BEGIN SELECT RAISE(ABORT,'test'); END;")
    await page.getByRole('button', { name: '收藏到生词队列', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('未能保存')
    await expect(page.getByLabel('德语复数')).toHaveValue('Prüfwörter')
    fault.exec('DROP TRIGGER test_save'); fault.close()
    await page.getByRole('button', { name: '收藏到生词队列', exact: true }).click()
    await expect(page.getByRole('button', { name: '已收藏到本机', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '新词', exact: true }).click()
    await page.getByLabel('单词或短语', { exact: true }).fill('not-collected')
    await page.keyboard.press('Escape')
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show())
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByLabel('主题', { exact: true }).selectOption('dark')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByLabel('全局快捷键').selectOption('Control+Shift+D')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await expect.poll(() => app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Shift+D'))).toBe(true)
    expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Alt+D'))).toBe(false)
    await page.screenshot({ path: info.outputPath('desktop-settings-dark.png'), fullPage: true })
    await app.close()
    app = await launch(profile); page = await app.firstWindow()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    const reply = await page.evaluate(() => window.polarCapture.queue({ search: '', state: 'all', offset: 0 }))
    expect(reply.ok && reply.value.total).toBe(2)
    if (reply.ok) { expect(reply.value.items.find(row => row.event.payload.lang === 'de')?.event.payload).toMatchObject({ lemma: 'Prüfwort', de: { article: 'das', plural: 'Prüfwörter' } }); expect(reply.value.items.every(row => row.state === 'pending')).toBe(true) }
    expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Shift+D'))).toBe(true)
    await page.getByRole('button', { name: '本地队列', exact: true }).click()
    await page.screenshot({ path: info.outputPath('desktop-queue-dark.png'), fullPage: true })
  } finally { await app.close() }
})

test('a separate real Electron process owns a conflicting shortcut; failed settings retain the old registration', async () => {
  const holderProfile = mkdtempSync(join(root, 'shortcut-owner-'))
  const holder = await electron.launch({ args: [resolve('apps/desktop/tests/fixtures/shortcut-owner.mjs')], env: { ...process.env, POLAR_VOCAB_CAPTURE_DATA_DIR: holderProfile } })
  let app: Awaited<ReturnType<typeof launch>> | undefined
  try {
    expect(await holder.evaluate(async ({ app, globalShortcut }) => { await app.whenReady(); return globalShortcut.isRegistered('Control+Shift+S') })).toBe(true)
    app = await launch(mkdtempSync(join(root, 'conflict-')), 'Control+Alt+D')
    const page = await app.firstWindow(); await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByLabel('全局快捷键').selectOption('Control+Shift+S'); await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await expect(page.getByRole('status').first()).toContainText('快捷键已被占用')
    const status = await page.evaluate(() => window.polarCapture.status()); expect(status.ok && status.value.settings.shortcut).toBe('Control+Alt+D')
    expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Alt+D'))).toBe(true)
  } finally { if (app) await app.close(); await holder.close() }
})

test('actual MyMemory requests via the desktop IPC and Electron network stack', async ({}, info) => {
  test.skip(process.env.PHASE4_LIVE_TRANSLATION !== '1', 'Explicit opt-in: external provider and its free anonymous quota.')
  const app = await launch(mkdtempSync(join(root, 'provider-')), 'Control+Alt+D'), results: unknown[] = []
  try {
    const page = await app.firstWindow()
    for (const [text, lang] of [['example', 'en'], ['Haus', 'de'], ['gehen', 'de'], ['Größe', 'de'], ['in fact', 'en']] as const) {
      const reply = await page.evaluate(({ text, lang }) => window.polarCapture.lookup({ id: crypto.randomUUID(), text, lang }), { text, lang })
      results.push({ text, lang, reply })
      expect(reply.ok, JSON.stringify(reply)).toBe(true)
      if (reply.ok) expect(reply.value.text.trim().length).toBeGreaterThan(0)
    }
    await page.getByLabel('单词或短语', { exact: true }).fill('example')
    await page.getByRole('button', { name: '查询中文释义', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('查询完成', { timeout: 15_000 })
    await page.getByLabel('中文释义', { exact: true }).fill('人工修改后的中文释义')
    await page.screenshot({ path: info.outputPath('actual-translation-edit.png'), fullPage: true })
  } finally { writeFileSync(join(root, 'provider-results-' + Date.now() + '.json'), JSON.stringify({ recordedAt: new Date().toISOString(), source: 'actual Electron net.fetch / MyMemory', results }, null, 2)); await app.close() }
})
