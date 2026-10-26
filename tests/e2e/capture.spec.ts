import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { FakeGitHub } from '../unit/sync/fake-github'
import { batchPath, editSense, emptyLexicon, encodeBatch, manualSense, type CaptureBatch } from '../../packages/shared'
import { toBase64 } from '../../src/integrations/github/client'

for (const variant of ['legacy v1', 'structured v2', 'integrated sentence v2']) test(`${variant} desktop batch preview, explicit ingestion, repeat receipts and Phase 3 upload preserve user edits`, async ({ page, context }) => {
  const structured = variant !== 'legacy v1', integrated = variant === 'integrated sentence v2'
  const fake = new FakeGitHub(), deviceId = randomUUID(), id = randomUUID()
  const batch: CaptureBatch = { format: 'polar-vocab-capture-batch', protocolVersion: structured ? 2 : 1, schemaVersion: 1, id: randomUUID(), deviceId, month: '2026-10', events: [{ id, deviceId, schemaVersion: 1, capturedAt: '2026-10-18T01:00:00.000Z', origin: 'windows', payload: { lang: 'de', lemma: 'Prüfwort', meanings: ['桌面人工释义'], de: { article: 'das', plural: 'Prüfwörter' }, contexts: [{ id: randomUUID(), text: 'Ein künstliches Prüfwort.' }], source: 'windows:artificial-e2e' } }] }
  if (structured) {
    const lexicon = { ...emptyLexicon(), senses: [editSense(editSense(manualSense(), 'chinese', '桌面人工释义'), 'partOfSpeech', 'noun')] }
    batch.events[0].payload.lexicon = lexicon
  }
  if (integrated) {
    batch.events[0].payload.encounteredForm = 'Prüfwörter'
    batch.events[0].payload.lemmaResolution = { lemma: 'Prüfwort', tags: ['form-of', 'plural'], source: { provider: 'wiktionary', url: 'https://en.wiktionary.org/wiki/Pr%C3%BCfw%C3%B6rter#German', license: 'CC-BY-SA-4.0' } }
    Object.assign(batch.events[0].payload.contexts![0], { translation: '一个人工测试词。', translationLanguage: 'zh-CN', translationSource: { provider: 'manual' } })
  }
  const path = batchPath(batch), text = encodeBatch(batch), sha = 'e'.repeat(40), size = Buffer.byteLength(text)
  await context.route('https://api.github.com/**', async route => {
    const request = route.request(), url = new URL(request.url())
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Authorization, Content-Type, X-GitHub-Api-Version, If-None-Match', 'access-control-allow-methods': 'GET, PUT, OPTIONS' }
    const send = (body: unknown) => route.fulfill({ status: 200, headers, body: JSON.stringify(body) })
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return }
    if (url.pathname.endsWith('/branches/main')) { await send({ commit: { commit: { tree: { sha: 'a'.repeat(40) } } } }); return }
    if (url.pathname.includes('/git/trees/')) { await send({ truncated: false, tree: [{ path, sha, size, type: 'blob' }] }); return }
    if (url.pathname.endsWith('/contents/' + path)) { expect(request.method()).toBe('GET'); await send({ path, sha, size, type: 'file', encoding: 'base64', content: toBase64(text) }); return }
    const response = await fake.fetch(request.url(), { method: request.method(), headers: request.headers(), body: request.postData() })
    await route.fulfill({ status: response.status, headers: { ...Object.fromEntries(response.headers), ...headers }, body: response.status === 304 ? '' : await response.text() })
  })
  await page.goto('./#/settings')
  await page.getByLabel('仓库所有者', { exact: true }).fill('example')
  await page.getByLabel('私有仓库名称', { exact: true }).fill('private-data')
  await page.getByLabel('Fine-grained PAT', { exact: true }).fill('artificial-session-value')
  await page.getByRole('button', { name: '测试连接（只读）', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '确认首次连接与数据合并' }); await expect(dialog).toBeVisible()
  const download = page.waitForEvent('download'); await dialog.getByRole('button', { name: '下载连接前完整备份' }).click(); await download
  await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: '确认连接并同步', exact: true }).click(); await expect(dialog).not.toBeVisible()
  await expect(page.locator('.sync-status')).toContainText('已同步')
  await page.goto('./#/inbox'); await page.getByText('接收桌面生词', { exact: true }).click()
  await page.getByRole('button', { name: '检查桌面采集批次', exact: true }).click()
  await page.getByRole('button', { name: '预览所选桌面批次', exact: true }).click()
  await expect(page.locator('.capture-preview-list')).toContainText('Prüfwort')
  expect(JSON.parse(fake.text!).snapshot.vocabularies).toHaveLength(0)
  await page.getByRole('button', { name: '确认接收到生词箱', exact: true }).click()
  await expect(page.getByRole('button', { name: '编辑 Prüfwort', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '预览所选桌面批次', exact: true }).click()
  await expect(page.locator('.capture-preview-list')).toContainText('已接收')
  await expect(page.getByRole('button', { name: '确认接收到生词箱', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '编辑 Prüfwort', exact: true }).click()
  const editor = page.getByRole('dialog'); await editor.getByLabel(structured ? '中文释义 1' : '释义 1', { exact: true }).fill('接收后手动修改')
  if (integrated) {
    await expect(editor.getByText(/遇到的词形：Prüfwörter/)).toBeVisible()
    await editor.getByRole('textbox', { name: '原句译文 1', exact: true }).fill('接收后人工编辑句译')
  }
  await editor.getByRole('button', { name: '保存修改', exact: true }).click(); await expect(editor).not.toBeVisible()
  await page.goto('./#/settings'); await page.getByRole('button', { name: '立即同步', exact: true }).click(); await expect(page.locator('.sync-status')).toContainText('已同步')
  const snapshot = JSON.parse(fake.text!).snapshot
  expect(snapshot.vocabularies).toHaveLength(1); expect(snapshot.captures).toHaveLength(1)
  expect(snapshot.vocabularies[0]).toMatchObject({ status: 'inbox', meanings: ['接收后手动修改'], de: { article: 'das', plural: 'Prüfwörter' } })
  if (structured) {
    expect(snapshot.vocabularies[0].lexicon.senses[0]).toMatchObject({ id: batch.events[0].payload.lexicon!.senses[0].id, chinese: '接收后手动修改', partOfSpeech: 'noun' })
    expect(snapshot.captures[0].payload.lexicon).toEqual(batch.events[0].payload.lexicon)
    expect(JSON.parse(fake.text!).protocolVersion).toBe(2)
  }
  if (integrated) {
    expect(snapshot.vocabularies[0]).toMatchObject({ encounteredForm: 'Prüfwörter', lemmaResolution: batch.events[0].payload.lemmaResolution, contexts: [{ id: batch.events[0].payload.contexts![0].id, text: 'Ein künstliches Prüfwort.', translation: '接收后人工编辑句译', translationLanguage: 'zh-CN', translationSource: { provider: 'manual', modified: true } }] })
    expect(snapshot.captures[0].payload.contexts).toEqual(batch.events[0].payload.contexts)
    expect(snapshot.captures[0].payload.encounteredForm).toBe('Prüfwörter')
  }
  expect(snapshot.cards).toHaveLength(0); expect(snapshot.reviewEvents).toHaveLength(0)
  expect(snapshot.ingestedCaptureIds).toContain(id)
})
