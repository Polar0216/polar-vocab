/* eslint-disable no-empty-pattern -- Exercises only our application in newly-created profiles. */
import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

test('fresh integrated app: sentence translation, interactive morphology, shared context, offline queue and restart', async ({}, info) => {
  const root = resolve('.cache/integrated-desktop-e2e'); mkdirSync(root, { recursive: true })
  const profile = mkdtempSync(join(root, 'fresh-'))
  const launch = () => electron.launch({ args: [resolve('apps/desktop')], env: { ...process.env, POLAR_VOCAB_CAPTURE_DATA_DIR: profile } })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: 'Polar Vocab Capture' })).toBeVisible()
    const initial = await page.evaluate(() => window.polarCapture.status()); expect(initial.ok && initial.value.migration.action).toBe('created')
    expect(initial.ok && initial.value.connected).toBe(false)
    await page.evaluate(async () => { const status = await window.polarCapture.status(); if (status.ok) await window.polarCapture.settings({ ...status.value.settings, shortcut: 'Control+Alt+D', autoLookup: false, autoSync: false }) })
    await app.evaluate(({ net }) => { net.fetch = async input => {
      const url = new URL(String(input))
      if (url.hostname === 'api.mymemory.translated.net') return Response.json({ responseStatus: 200, responseData: { translatedText: '人工整合翻译：' + url.searchParams.get('q'), match: 1 } })
      if (url.pathname.endsWith('/release.json')) return Response.json({ format: 'polar-vocab-web-release', version: '0.6.0', captureProtocols: [1, 2], stateProtocols: [1, 2], features: ['context-morphology'] })
      const word = decodeURIComponent(url.pathname.split('/word/')[1]?.split('/')[0] ?? '')
      const target = ({ persevered: 'persevere', difficulties: 'difficulty' } as Record<string, string>)[word]
      const item = { glosses: [target ? `inflection of ${target}` : `Artificial definition of ${word}`], tags: target ? ['form-of', 'past'] : [], ...(target ? { form_of: [{ word: target }] } : {}) }
      if (url.pathname.endsWith('/definitions')) return Response.json({ word, edition: 'en', definitions: [{ pos: target === 'difficulty' || word === 'difficulty' ? 'noun' : 'verb', lang_code: 'en', senses: [item] }] })
      if (url.pathname.endsWith('/forms')) return Response.json({ word, edition: 'en', forms: [] })
      if (url.pathname.endsWith('/pronunciations')) return Response.json({ word, edition: 'en', pronunciations: [] })
      return Response.json({ word, edition: 'en', entries: [{ senses: [item], forms: [], sounds: [], translations: [] }] })
    } })
    const sentence = 'I persevered through difficulties.'
    await page.getByLabel('单词或短语', { exact: true }).fill(sentence)
    await expect(page.getByRole('region', { name: '整句翻译与选词' })).toBeVisible()
    await expect(page.getByTestId('interactive-source')).toHaveText(sentence)
    await page.getByRole('button', { name: '翻译所选文本', exact: true }).click()
    await expect(page.getByLabel('整句中文译文', { exact: true })).not.toHaveValue('')
    await page.getByLabel('整句中文译文', { exact: true }).fill('人工核对后的句译')
    await page.getByLabel('收藏时保留已核对的句子译文', { exact: true }).check()
    await page.getByRole('button', { name: '查词 persevered', exact: true }).click()
    await expect(page.getByLabel('当前收藏词条', { exact: true })).toHaveValue('persevere')
    await expect(page.getByLabel('中文释义 1', { exact: true })).not.toHaveValue('')
    await page.getByRole('button', { name: '收藏到生词队列', exact: true }).click()
    await expect(page.getByRole('button', { name: '已收藏到本机', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '查词 difficulties', exact: true }).click()
    await expect(page.getByLabel('当前收藏词条', { exact: true })).toHaveValue('difficulty')
    await page.getByLabel('原句', { exact: true }).fill('Changed artificial context.')
    await expect(page.getByLabel('收藏时保留已核对的句子译文', { exact: true })).not.toBeChecked()
    await page.getByRole('button', { name: '查词 difficulties', exact: true }).click()
    await expect(page.getByLabel('原句', { exact: true })).toHaveValue(sentence)
    await expect(page.getByLabel('当前收藏词条', { exact: true })).toHaveValue('difficulty')
    await page.getByLabel('收藏时保留已核对的句子译文', { exact: true }).check()
    await page.getByRole('button', { name: '收藏到生词队列', exact: true }).click()
    await expect(page.getByRole('button', { name: '已收藏到本机', exact: true })).toBeDisabled()
    // Changing language after save creates a new editable draft and clears MT provenance.
    await page.getByLabel('查询语言', { exact: true }).selectOption('de')
    await expect(page.getByLabel('整句中文译文', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('收藏时保留已核对的句子译文', { exact: true })).not.toBeChecked()
    await expect(page.getByLabel('中文释义 1', { exact: true })).toBeEnabled()
    const queue = await page.evaluate(() => window.polarCapture.queue({ search: '', state: 'all', offset: 0 })); expect(queue.ok).toBe(true)
    if (queue.ok) {
      expect(queue.value.total).toBe(2)
      const events = queue.value.items.map(row => row.event)
      expect(events.map(event => event.payload.lemma).sort()).toEqual(['difficulty', 'persevere'])
      expect(events.map(event => event.payload.encounteredForm).sort()).toEqual(['difficulties', 'persevered'])
      expect(new Set(events.map(event => event.payload.contexts![0].id)).size).toBe(1)
      expect(events.every(event => event.payload.contexts![0].text === sentence && event.payload.contexts![0].translation === '人工核对后的句译')).toBe(true)
      expect(events.every(event => event.payload.lemmaResolution?.source.provider === 'wiktionary')).toBe(true)
    }
    await page.screenshot({ path: info.outputPath('sentence-words-saved.png'), fullPage: true })
    // A manually selected word mode on a sentence still exposes a usable query target.
    await page.getByRole('button', { name: '新词', exact: true }).click()
    await page.getByLabel('单词或短语', { exact: true }).fill('A sentence can be edited.')
    await page.getByLabel('查询模式', { exact: true }).selectOption('word')
    await expect(page.getByLabel('当前收藏词条', { exact: true })).toBeVisible()
    await page.getByLabel('当前收藏词条', { exact: true }).fill('edited')
    await page.evaluate(async () => { const status = await window.polarCapture.status(); if (status.ok) await window.polarCapture.settings({ ...status.value.settings, onlineLookup: false }) })
    const refused = await page.evaluate(() => window.polarCapture.lookup({ id: crypto.randomUUID(), text: 'offline', lang: 'en' })); expect(refused.ok).toBe(false)
    await page.getByLabel('中文释义 1', { exact: true }).fill('离线手动义项')
    await page.getByRole('button', { name: '收藏到生词队列', exact: true }).click()
    await expect(page.getByRole('button', { name: '已收藏到本机', exact: true })).toBeDisabled()
    await app.close(); app = await launch(); page = await app.firstWindow()
    const reopened = await page.evaluate(() => window.polarCapture.queue({ search: '', state: 'all', offset: 0 })); expect(reopened.ok && reopened.value.total).toBe(3)
    const db = new DatabaseSync(join(profile, 'captures.sqlite'), { readOnly: true }); expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(2); db.close()
  } finally { await app.close() }
})
