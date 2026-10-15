import { chromium, test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { zipSync, strToU8 } from 'fflate'

const base = process.env.PAGES_BASE_PATH ?? '/polar-vocab/'
async function inbox(page: Page) {
  await page.goto('./#/inbox')
  await expect(page.getByRole('button', { name: '保存生词', exact: true })).toBeVisible()
}
async function add(page: Page, lemma: string, language = 'en') {
  await page.getByRole('textbox', { name: '单词或短语', exact: true }).fill(lemma)
  await page.getByRole('combobox', { name: '录入语言', exact: true }).selectOption(language)
  await page.getByRole('button', { name: '保存生词', exact: true }).click()
  await expect(page.getByRole('button', { name: `编辑 ${lemma}`, exact: true })).toBeVisible()
}

function xlsxFixture(): Uint8Array {
  const xml = (body: string) => strToU8(`<?xml version="1.0" encoding="UTF-8"?>${body}`)
  return zipSync({
    '[Content_Types].xml': xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    '_rels/.rels': xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': xml('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Words" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': xml('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>word</t></is></c><c r="B1" t="inlineStr"><is><t>lang</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Größe</t></is></c><c r="B2" t="inlineStr"><is><t>de</t></is></c></row></sheetData></worksheet>'),
  })
}

test('manual collection, full edit, language filters and offline persistence', async ({ page, context }, testInfo) => {
  await inbox(page)
  await add(page, 'offline-example')
  await add(page, 'Entscheidung', 'de')
  await page.getByRole('button', { name: '编辑 Entscheidung', exact: true }).click()
  const editor = page.getByRole('dialog')
  await editor.getByLabel('词性', { exact: true }).fill('名词')
  await editor.getByRole('combobox', { name: '定冠词', exact: true }).selectOption('die')
  await editor.getByLabel('复数', { exact: true }).fill('Entscheidungen')
  await editor.getByRole('button', { name: '添加释义', exact: true }).click()
  await editor.getByRole('textbox', { name: '释义 1', exact: true }).fill('决定')
  await editor.getByLabel('来源', { exact: true }).fill('人工公开测试')
  if (testInfo.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 700 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('editor-320.png') })
  }
  await editor.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(editor).not.toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: '编辑 Entscheidung', exact: true })).toBeVisible()
  await expect(page.getByText('决定', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  await context.setOffline(true)
  await add(page, 'offline-saved')
  await page.reload()
  await expect(page.getByRole('button', { name: '编辑 offline-saved', exact: true })).toBeVisible()
  await context.setOffline(false)
  const another = await context.newPage()
  await inbox(another)
  await expect(another.getByRole('button', { name: '编辑 offline-saved', exact: true })).toBeVisible()
  await another.close()
  await page.goto('./#/vocabulary')
  await page.getByRole('combobox', { name: '筛选语言', exact: true }).selectOption('de')
  await expect(page.getByRole('button', { name: '编辑 Entscheidung', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '编辑 offline-example', exact: true })).not.toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('vocabulary.png'), fullPage: true })
})

test('CSV preview, cancel, duplicate supplementation and lazy XLSX import offline', async ({ page, context }) => {
  await inbox(page)
  await add(page, 'existing')
  await page.getByText('导入词汇文件 · CSV / TXT / XLSX', { exact: true }).click()
  const upload = page.getByLabel('选择词汇文件', { exact: true })
  const csv = '\uFEFFword,lang,meaning,context,source,tags,created_at\r\nexisting,en,"已有,释义","a ""quoted"" sentence",Numbers,fixture,2026-10-14\r\nnew-csv,de,新词,,,,2026-10-14\r\ninvalid,fr,,,,,2026-10-14'
  await upload.setInputFiles({ name: 'numbers.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.getByRole('button', { name: '确认导入有效行', exact: true })).toBeEnabled()
  await expect(page.getByText(/第 4 行/)).toBeVisible()
  await expect(page.getByRole('button', { name: '编辑 new-csv', exact: true })).not.toBeVisible()
  await page.getByRole('button', { name: '取消导入', exact: true }).click()
  await expect(page.getByRole('button', { name: '编辑 new-csv', exact: true })).not.toBeVisible()
  await upload.setInputFiles({ name: 'numbers.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await page.getByRole('combobox', { name: '第 2 行重复处理', exact: true }).selectOption('fill-empty-fields')
  await page.getByRole('button', { name: '确认导入有效行', exact: true }).click()
  await expect(page.getByRole('button', { name: '编辑 new-csv', exact: true })).toBeVisible()
  await expect(page.getByText('已有,释义', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  await context.setOffline(true)
  await upload.setInputFiles({ name: 'words.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(xlsxFixture()) })
  await expect(page.getByRole('button', { name: '确认导入有效行', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '确认导入有效行', exact: true }).click()
  await expect(page.getByRole('button', { name: '编辑 Größe', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: '编辑 Größe', exact: true })).toBeVisible()
  await context.setOffline(false)
})

test('clipboard reads only on click, manual fallback and multiline confirmation', async ({ page }) => {
  await page.addInitScript(() => {
    let reads = 0
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => { reads++; (window as unknown as { clipboardReads: number }).clipboardReads = reads; throw new DOMException('denied', 'NotAllowedError') } } })
    ;(window as unknown as { clipboardReads: number }).clipboardReads = 0
  })
  await inbox(page)
  expect(await page.evaluate(() => (window as unknown as { clipboardReads: number }).clipboardReads)).toBe(0)
  await page.getByRole('button', { name: '从剪贴板导入', exact: true }).click()
  await expect(page.getByText('手动粘贴文本', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { clipboardReads: number }).clipboardReads)).toBe(1)
  await page.getByRole('textbox', { name: '剪贴板或手动粘贴文本', exact: true }).fill('one phrase\nGrüße\tde\t问候')
  await page.getByRole('button', { name: '生成预览', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认导入有效行', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: '编辑 one phrase', exact: true })).not.toBeVisible()
  await page.getByRole('button', { name: '确认导入有效行', exact: true }).click()
  await expect(page.getByRole('button', { name: '编辑 one phrase', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '编辑 Grüße', exact: true })).toBeVisible()
})

test('full JSON download, guarded clearing and restore round-trip in actual browser', async ({ page }) => {
  await inbox(page); await add(page, 'backup-fixture')
  await page.goto('./#/settings')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出完整 JSON 备份', exact: true }).click()
  const download = await downloadPromise
  const path = await download.path()
  expect(path).toBeTruthy()
  const original = await readFile(path!)
  const content = JSON.parse(original.toString('utf8'))
  expect(content.snapshot.vocabularies[0].lemma).toBe('backup-fixture')
  await page.getByRole('button', { name: '准备清除本机数据', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: '确认清除', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: '先下载清除前备份', exact: true }).click()
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('textbox', { name: '清除确认文字', exact: true }).fill('清除本机数据')
  await dialog.getByRole('button', { name: '确认清除', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByLabel('选择完整备份 JSON', { exact: true }).setInputFiles({ name: 'restore.json', mimeType: 'application/json', buffer: original })
  dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: '确认覆盖恢复', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: '先下载当前工作区备份', exact: true }).click()
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: '确认覆盖恢复', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.goto('./#/vocabulary')
  await expect(page.getByRole('button', { name: '编辑 backup-fixture', exact: true })).toBeVisible()
})

test('closes the browser process and reopens the same IndexedDB profile', async ({ isMobile }, testInfo) => {
  test.skip(isMobile, 'One real browser restart is sufficient; mobile cases use independent device emulation.')
  const profile = testInfo.outputPath('persistent-browser-profile')
  const launch = () => chromium.launchPersistentContext(profile, { headless: true, channel: process.env.PLAYWRIGHT_CHANNEL, baseURL: `http://127.0.0.1:4173${base}` })
  let context = await launch()
  try { const page = await context.newPage(); await inbox(page); await add(page, 'browser-restart-fixture') } finally { await context.close() }
  context = await launch()
  try { const page = await context.newPage(); await inbox(page); await expect(page.getByRole('button', { name: '编辑 browser-restart-fixture', exact: true })).toBeVisible() } finally { await context.close() }
})
