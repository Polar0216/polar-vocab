import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { FakeGitHub } from '../unit/sync/fake-github'
import { randomUUID } from 'node:crypto'

test.setTimeout(60_000)
async function mock(context: BrowserContext, fake: FakeGitHub) {
  await context.route('https://api.github.com/**', async (route) => {
    try {
      const request = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Authorization, Content-Type, X-GitHub-Api-Version, If-None-Match', 'access-control-allow-methods': 'GET, PUT, OPTIONS', 'access-control-expose-headers': 'ETag, Retry-After, X-RateLimit-Reset, X-RateLimit-Remaining' }
      if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }
      const response = await fake.fetch(request.url(), { method: request.method(), headers: request.headers(), body: request.postData() })
      await route.fulfill({ status: response.status, headers: { ...Object.fromEntries(response.headers), ...cors }, body: response.status === 304 ? '' : await response.text() })
    } catch { await route.abort('failed') }
  })
}
async function add(page: Page, word: string) { await page.goto('./#/inbox'); await page.getByLabel('单词或短语', { exact: true }).fill(word); await page.getByRole('button', { name: '保存生词', exact: true }).click(); await expect(page.getByRole('button', { name: '编辑 ' + word, exact: true })).toBeVisible() }
async function connect(page: Page) {
  await page.goto('./#/settings'); await page.getByLabel('仓库所有者', { exact: true }).fill('example'); await page.getByLabel('私有仓库名称', { exact: true }).fill('private-data'); await page.getByLabel('Fine-grained PAT', { exact: true }).fill('artificial-session-value')
  await page.getByRole('button', { name: '测试连接（只读）', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '确认首次连接与数据合并' }); await expect(dialog).toBeVisible()
  const download = page.waitForEvent('download'); await dialog.getByRole('button', { name: '下载连接前完整备份' }).click(); await download
  await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: '确认连接并同步', exact: true }).click(); await expect(dialog).not.toBeVisible(); await expect(page.locator('.sync-status')).toContainText('已同步')
}
test('connect, offline pending, foreground recovery, fresh authorization and secret-free backup/cache', async ({ page, context }) => {
  const fake = new FakeGitHub(); await mock(context, fake); await add(page, '<img src=x onerror=alert(1)>'); await connect(page)
  expect(fake.text).not.toContain('artificial-session-value'); expect(fake.requests.every((r) => !r.url.includes('artificial-session-value'))).toBe(true)
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true); await context.setOffline(true); await add(page, 'offline-fixture'); await page.goto('./#/settings'); await expect(page.locator('.sync-status')).toContainText('当前离线'); await expect(page.getByRole('button', { name: '立即同步', exact: true })).toBeDisabled(); await context.setOffline(false)
  await page.getByRole('button', { name: '立即同步', exact: true }).click(); await expect(page.locator('.sync-status')).toContainText('已同步')
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: '导出完整 JSON 备份', exact: true }).click(); const download = await downloadPromise; expect(await readFile((await download.path())!, 'utf8')).not.toContain('artificial-session-value')
  const cached = await page.evaluate(async () => { const urls = []; for (const key of await caches.keys()) for (const req of await (await caches.open(key)).keys()) urls.push(req.url); return urls }); expect(cached.every((url) => !url.includes('api.github.com'))).toBe(true)
  await page.reload(); await expect(page.locator('.sync-status')).toContainText('需要重新授权'); await expect(page.getByLabel('Fine-grained PAT', { exact: true })).toHaveValue(''); await connect(page)
  await page.setViewportSize({ width: 320, height: 700 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'reports/test-results/sync-320.png', fullPage: true }); await page.getByRole('button', { name: '断开连接，保留本机数据', exact: true }).click(); await expect(page.locator('.sync-status')).toContainText('未连接'); expect(JSON.parse(fake.text!).snapshot.vocabularies).toHaveLength(2)
})
test('remote field conflict preview and explicit decision preserve both audit copies', async ({ page, context }) => {
  const fake = new FakeGitHub(); await mock(context, fake); await add(page, 'conflict-fixture'); await connect(page)
  const remote = JSON.parse(fake.text!); remote.snapshot.vocabularies[0].meanings = ['远端人工释义']; remote.snapshot.vocabularies[0].parentRevisionIds = [remote.snapshot.vocabularies[0].revisionId]; remote.snapshot.vocabularies[0].revisionId = randomUUID(); remote.snapshot.id = randomUUID(); remote.snapshotId = remote.snapshot.id; fake.text = JSON.stringify(remote); fake.version++
  await page.goto('./#/vocabulary'); await page.getByRole('button', { name: '编辑 conflict-fixture', exact: true }).click(); const editor = page.getByRole('dialog'); await editor.getByRole('button', { name: '添加释义', exact: true }).click(); await editor.getByLabel('释义 1', { exact: true }).fill('本机人工释义'); await editor.getByRole('button', { name: '保存修改', exact: true }).click(); await expect(editor).not.toBeVisible()
  await page.goto('./#/settings'); await page.getByRole('button', { name: '立即同步', exact: true }).click(); await expect(page.locator('.sync-status')).toContainText('未解决冲突'); await page.getByRole('button', { name: '采用本机版本', exact: true }).click(); const decision = page.getByRole('dialog', { name: '确认冲突决议' }); await decision.getByRole('checkbox').check(); await decision.getByRole('button', { name: '保存决议', exact: true }).click(); await expect(decision).not.toBeVisible(); await page.getByRole('button', { name: '立即同步', exact: true }).click(); await expect(page.locator('.sync-status')).toContainText('已同步'); expect(JSON.parse(fake.text!).snapshot.vocabularies[0].meanings).toEqual(['本机人工释义'])
})
test('two browser tabs cannot upload simultaneously', async ({ page, context }) => {
  const fake = new FakeGitHub(); await mock(context, fake); await connect(page); const second = await context.newPage(); await connect(second); await add(page, 'locked-fixture')
  let release!: () => void, started!: () => void; const held = new Promise<void>((resolve) => { release = resolve }), signal = new Promise<void>((resolve) => { started = resolve }); fake.beforePut = async () => { started(); await held }
  await page.goto('./#/settings'); await page.getByRole('button', { name: '立即同步', exact: true }).click(); await signal; await second.getByRole('button', { name: '立即同步', exact: true }).click(); await expect(second.getByRole('alert')).toContainText('另一标签页'); release(); await expect(page.locator('.sync-status')).toContainText('已同步'); await second.close()
})
test('two separate browser devices resolve a real FSRS fork and continue grading', async ({ page, context, browser }) => {
  const fake = new FakeGitHub(); await mock(context, fake)
  await page.goto('./#/inbox'); await page.getByText('导入词汇文件 · CSV / TXT / XLSX', { exact: true }).click(); await page.getByLabel('选择词汇文件', { exact: true }).setInputFiles({ name: 'fork.csv', mimeType: 'text/csv', buffer: Buffer.from('word,lang,meaning\nbrowser-fork,en,人工答案') }); await page.getByRole('button', { name: '确认导入有效行', exact: true }).click(); await expect(page.getByRole('button', { name: '编辑 browser-fork', exact: true })).toBeVisible()
  await page.goto('./#/vocabulary'); await page.getByRole('checkbox', { name: /全选当前筛选/ }).check(); await page.getByRole('combobox', { name: '批量状态', exact: true }).selectOption('learning'); await page.getByRole('button', { name: '应用状态', exact: true }).click(); await expect(page.getByText('批量修改已保存到本机。待同步操作已保留，请在设置查看云端确认状态。', { exact: true })).toBeVisible(); await page.getByRole('checkbox', { name: /全选当前筛选/ }).check(); await page.getByRole('button', { name: '选中词条加入复习', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: '确认创建卡片', exact: true }).click(); await connect(page)
  const secondContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' + (process.env.PAGES_BASE_PATH ?? '/polar-vocab/') }); await mock(secondContext, fake); const second = await secondContext.newPage(); await connect(second)
  for (const [device, rating] of [[page, 'Good'], [second, 'Again']] as const) { await device.goto('./#/review'); await device.getByRole('button', { name: '开始复习', exact: true }).click(); await device.getByRole('button', { name: '显示答案', exact: true }).click(); await device.getByRole('region', { name: '当前学习卡片', exact: true }).getByRole('button', { name: new RegExp('^' + rating) }).click(); await expect(device.getByLabel('今日完成次数', { exact: true })).toHaveText('1') }
  await page.goto('./#/settings'); await page.getByRole('button', { name: '立即同步', exact: true }).click(); await expect(page.locator('.sync-status')).toContainText('已同步'); await second.goto('./#/settings'); await second.getByRole('button', { name: '立即同步', exact: true }).click(); await expect(second.locator('.sync-status')).toContainText('未解决冲突'); await second.getByRole('button', { name: '采用 Good 分支', exact: true }).click(); const dialog = second.getByRole('dialog', { name: '确认冲突决议' }); await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: '保存决议', exact: true }).click(); await expect(dialog).not.toBeVisible(); await second.getByRole('button', { name: '立即同步', exact: true }).click(); await expect(second.locator('.sync-status')).toContainText('已同步')
  const snapshot = JSON.parse(fake.text!).snapshot; expect(snapshot.reviewEvents).toHaveLength(2); expect(snapshot.reviewResolutions).toHaveLength(1)
  await second.clock.install({ time: new Date(Date.parse(snapshot.cards[0].fsrsState.due) + 1000) }); await second.goto('./#/review'); await second.getByRole('button', { name: '开始复习', exact: true }).click(); await second.getByRole('button', { name: '显示答案', exact: true }).click(); await second.getByRole('region', { name: '当前学习卡片', exact: true }).getByRole('button', { name: /^Good/ }).click(); await expect(second.getByLabel('今日完成次数', { exact: true })).toHaveText('2'); await secondContext.close()
})
test('browser process restart preserves outbox and requires a new memory credential', async ({ browserName }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Process restart is executed once on desktop; this is not real Safari.')
  expect(browserName).toBe('chromium'); const fake = new FakeGitHub(), profile = testInfo.outputPath('sync-profile'), base = 'http://127.0.0.1:4173' + (process.env.PAGES_BASE_PATH ?? '/polar-vocab/')
  let context = await chromium.launchPersistentContext(profile, { channel: process.env.PLAYWRIGHT_CHANNEL, baseURL: base }); await mock(context, fake); let page = await context.newPage(); await connect(page); await add(page, 'restart-pending'); await context.close()
  context = await chromium.launchPersistentContext(profile, { channel: process.env.PLAYWRIGHT_CHANNEL, baseURL: base }); await mock(context, fake); page = await context.newPage(); await page.goto('./#/settings'); await expect(page.locator('.sync-status')).toContainText('需要重新授权'); await connect(page); expect(JSON.parse(fake.text!).snapshot.vocabularies.map((w: { lemma: string }) => w.lemma)).toContain('restart-pending'); await context.close()
})
