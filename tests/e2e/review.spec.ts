import { chromium, expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { Flashcard, ReviewEvent } from '../../src/domain'

test.setTimeout(60_000)
const base = process.env.PAGES_BASE_PATH ?? '/polar-vocab/'
interface LearningState { cards: Flashcard[]; events: ReviewEvent[] }
async function stored(page: Page): Promise<LearningState> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('polar-vocab'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    try {
      const read = <T,>(name: string) => new Promise<T[]>((resolve, reject) => { const request = db.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result as T[]); request.onerror = () => reject(request.error) })
      return { cards: await read<Flashcard>('cards'), events: await read<ReviewEvent>('reviewEvents') }
    } finally { db.close() }
  })
}
async function createViaUi(page: Page, count = 1) {
  await page.goto('./#/inbox')
  await page.getByText('导入词汇文件 · CSV / TXT / XLSX', { exact: true }).click()
  const csv = 'word,lang,meaning\n' + Array.from({ length: count }, (_, index) => 'study-' + index + ',en,人工公开答案-' + index).join('\n')
  await page.getByLabel('选择词汇文件', { exact: true }).setInputFiles({ name: 'review-fixtures.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await page.getByRole('button', { name: '确认导入有效行', exact: true }).click()
  await expect(page.getByRole('button', { name: '编辑 study-0', exact: true })).toBeVisible()
  await page.goto('./#/vocabulary')
  await page.getByRole('checkbox', { name: /全选当前筛选/ }).check()
  await page.getByRole('combobox', { name: '批量状态', exact: true }).selectOption('learning')
  await page.getByRole('button', { name: '应用状态', exact: true }).click()
  await expect(page.getByText('批量修改已保存到本机。待同步操作已保留，请在设置查看云端确认状态。', { exact: true })).toBeVisible()
  await page.getByRole('checkbox', { name: /全选当前筛选/ }).check()
  await page.getByRole('button', { name: '选中词条加入复习', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('准备创建 ' + count + ' 张词义卡片')
  expect((await stored(page)).cards).toHaveLength(0)
  await dialog.getByRole('button', { name: '确认创建卡片', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect((await stored(page)).cards).toHaveLength(count)
}
async function begin(page: Page) {
  await page.goto('./#/review')
  await page.getByRole('button', { name: '开始复习', exact: true }).click()
  return page.getByRole('region', { name: '当前学习卡片', exact: true })
}
test('four grades, rapid duplicate click, offline persistence and complete learning backup', async ({ page, context }, testInfo) => {
  await createViaUi(page, 4)
  let study = await begin(page)
  await expect(study.getByLabel('卡片答案')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  await context.setOffline(true)
  for (const [index, rating] of ['Again', 'Hard', 'Good', 'Easy'].entries()) {
    await study.getByRole('button', { name: '显示答案', exact: true }).click()
    await expect(study.getByLabel('卡片答案')).toContainText('人工公开答案')
    if (index === 0) await study.getByRole('button', { name: /^Again/ }).evaluate((element: HTMLButtonElement) => { element.click(); element.click() })
    else await study.getByRole('button', { name: new RegExp('^' + rating) }).click()
    await expect(page.getByLabel('今日完成次数', { exact: true })).toHaveText(String(index + 1))
    study = page.getByRole('region', { name: '当前学习卡片', exact: true })
  }
  const state = await stored(page)
  expect(state.events.map((event) => event.rating).sort()).toEqual(['Again', 'Easy', 'Good', 'Hard'])
  expect(new Set(state.events.map((event) => event.cardId)).size).toBe(4)
  for (const event of state.events) {
    expect(event.configuration.weights).toHaveLength(21)
    expect(event.afterState.reps).toBe(1)
    expect(Date.parse(event.afterState.due)).toBeGreaterThan(Date.parse(event.reviewedAt))
  }
  await page.reload(); await expect(page.getByLabel('今日完成次数', { exact: true })).toHaveText('4')
  const reopened = await context.newPage(); await reopened.goto('./#/review'); await expect(reopened.getByLabel('今日完成次数', { exact: true })).toHaveText('4'); await reopened.close()
  await context.setOffline(false)
  await page.goto('./#/settings')
  const downloadWait = page.waitForEvent('download'); await page.getByRole('button', { name: '导出完整 JSON 备份', exact: true }).click()
  const download = await downloadWait; const raw = await readFile((await download.path())!)
  expect(JSON.parse(raw.toString()).snapshot.reviewEvents).toHaveLength(4)
  await page.getByRole('button', { name: '准备清除本机数据', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '先下载清除前备份', exact: true }).click(); await dialog.getByRole('checkbox').check()
  await dialog.getByRole('textbox', { name: '清除确认文字', exact: true }).fill('清除本机数据'); await dialog.getByRole('button', { name: '确认清除', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByLabel('选择完整备份 JSON', { exact: true }).setInputFiles({ name: 'learning.json', mimeType: 'application/json', buffer: raw })
  dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: '先下载当前工作区备份', exact: true }).click(); await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: '确认覆盖恢复', exact: true }).click()
  await expect(dialog).not.toBeVisible(); await page.goto('./#/review')
  await expect(page.getByLabel('今日完成次数', { exact: true })).toHaveText('4')
  expect((await stored(page)).events).toEqual(state.events)
  if (testInfo.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 700 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('review-history.png'), fullPage: true })
})
test('new quota survives refresh and Learning re-enters at its real due time', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-10-14T06:00:00Z') })
  await createViaUi(page, 2)
  await page.goto('./#/settings')
  await page.getByRole('spinbutton', { name: '英语每日新卡上限', exact: true }).fill('1')
  await page.getByRole('button', { name: '保存学习设置', exact: true }).click()
  await expect(page.getByText(/学习设置已保存。配额按今日/)).toBeVisible()
  let study = await begin(page); await study.getByRole('button', { name: '显示答案', exact: true }).click(); await study.getByRole('button', { name: /^Again/ }).click()
  await expect(page.getByLabel('今日完成次数', { exact: true })).toHaveText('1')
  await expect(page.getByLabel('今日可学新卡', { exact: true })).toHaveText('0')
  await page.reload(); await expect(page.getByLabel('今日可学新卡', { exact: true })).toHaveText('0')
  await page.clock.fastForward(61_000)
  await expect(page.getByLabel('今日到期卡片', { exact: true })).toHaveText('1')
  await page.getByRole('button', { name: '开始复习', exact: true }).click(); study = page.getByRole('region', { name: '当前学习卡片', exact: true })
  await study.getByRole('button', { name: '显示答案', exact: true }).click()
  if (testInfo.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 700 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await study.scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath('study-answer.png') })
  await study.getByRole('button', { name: /^Good/ }).click(); await expect(page.getByLabel('今日完成次数', { exact: true })).toHaveText('2')
  expect(new Set((await stored(page)).events.map((event) => event.cardId)).size).toBe(1)
  const learning = (await stored(page)).cards.find((card) => card.fsrsState.state === 1)!
  const remaining = Date.parse(learning.fsrsState.due) - await page.evaluate(() => Date.now())
  await page.clock.fastForward(remaining + 16_000)
  await expect(page.getByRole('heading', { name: '有到期任务，可以继续学习', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '继续学习', exact: true }).click()
  study = page.getByRole('region', { name: '当前学习卡片', exact: true })
  await study.getByRole('button', { name: '显示答案', exact: true }).click(); await study.getByRole('button', { name: /^Good/ }).click()
  await expect(page.getByLabel('今日完成次数', { exact: true })).toHaveText('3')
  await page.goto('./#/'); await expect(page.getByLabel('活动卡片数', { exact: true })).toHaveText('2')
})
test('two actual tabs cannot grade the same old state twice', async ({ page, context }) => {
  await createViaUi(page)
  const studyA = await begin(page); await studyA.getByRole('button', { name: '显示答案', exact: true }).click()
  const other = await context.newPage(); const studyB = await begin(other); await studyB.getByRole('button', { name: '显示答案', exact: true }).click()
  await studyA.getByRole('button', { name: /^Easy/ }).click()
  await expect(other.getByText(/另一页面已更新、暂停或移除/)).toBeVisible()
  await expect(studyB.getByRole('button', { name: /^Good/ })).toBeDisabled()
  expect((await stored(other)).events).toHaveLength(1)
  await studyB.getByRole('button', { name: '重新读取任务', exact: true }).click()
  await expect(other.getByLabel('今日完成次数', { exact: true })).toHaveText('1')
  await other.close()
})
test('learning events persist after closing the actual browser process', async ({ isMobile }, testInfo) => {
  test.skip(isMobile, 'Actual process restart is covered once on desktop; mobile project is device emulation.')
  const profile = testInfo.outputPath('persistent-learning-profile')
  const launch = () => chromium.launchPersistentContext(profile, { headless: true, channel: process.env.PLAYWRIGHT_CHANNEL, baseURL: 'http://127.0.0.1:4173' + base })
  let context = await launch()
  try { const page = await context.newPage(); await createViaUi(page); const study = await begin(page); await study.getByRole('button', { name: '显示答案', exact: true }).click(); await study.getByRole('button', { name: /^Easy/ }).click(); await expect(page.getByLabel('今日完成次数', { exact: true })).toHaveText('1') } finally { await context.close() }
  context = await launch()
  try { const page = await context.newPage(); await page.goto('./#/review'); await expect(page.getByLabel('今日完成次数', { exact: true })).toHaveText('1'); expect((await stored(page)).events).toHaveLength(1) } finally { await context.close() }
})
