/* eslint-disable no-empty-pattern -- Drives only isolated development instances. */
import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { defaultSettings } from '../../src/contracts'

const root = resolve('.cache/phase4.1-dictionary/electron'); mkdirSync(root, { recursive: true })
async function launch() {
  const profile = mkdtempSync(join(root, 'profile-')), db = new DatabaseSync(join(profile, 'captures.sqlite'))
  db.exec('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
  db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run('settings', JSON.stringify({ ...defaultSettings, shortcut: 'Control+Alt+D', autoLookup: false, autoSync: false })); db.close()
  return electron.launch({ args: [resolve('apps/desktop')], env: { ...process.env, POLAR_VOCAB_CAPTURE_DATA_DIR: profile } })
}
test('structured sense UI: artificial providers, late translation, edits/add/delete, repeat query/save and IPC SQLite persistence', async ({}, info) => {
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ net }) => { net.fetch = async (input, options) => {
      const url = new URL(String(input))
      if (url.hostname === 'api.mymemory.translated.net') {
        await new Promise(resolve => setTimeout(resolve, 1200))
        if (options?.signal?.aborted) throw new Error('aborted')
        return Response.json({ responseStatus: 200, responseData: { translatedText: '人工翻译响应：' + url.searchParams.get('q'), match: 1 } })
      }
      if (url.pathname.includes('/definitions')) return Response.json({ word: 'test', edition: 'en', definitions: [{ pos: 'noun', lang_code: 'en', senses: [{ glosses: ['First artificial definition'] }, { glosses: ['Second artificial definition'] }, { glosses: ['Fifth artificial definition'] }] }, { pos: 'verb', lang_code: 'en', senses: [{ glosses: ['Third artificial definition'] }, { glosses: ['Fourth artificial definition'] }] }] })
      if (url.pathname.includes('/forms')) return Response.json({ word: 'test', edition: 'en', forms: [] })
      return Response.json({ word: 'test', edition: 'en', pronunciations: [] })
    } })
    await page.getByLabel('单词或短语', { exact: true }).fill('test')
    await page.getByRole('button', { name: '查询词典', exact: true }).click()
    await expect(page.getByLabel('原文释义 1', { exact: true })).toHaveValue('First artificial definition')
    await page.getByLabel('中文释义 1', { exact: true }).fill('人工保留的释义')
    await page.getByLabel('词性 1', { exact: true }).fill('人工词性')
    await page.getByRole('button', { name: '删除义项 2', exact: true }).click()
    await page.getByRole('button', { name: '新增义项', exact: true }).click()
    await page.getByLabel('中文释义 5', { exact: true }).fill('手动新增义项')
    await expect(page.getByRole('status').first()).toContainText('查询完成', { timeout: 10000 })
    await expect(page.getByLabel('中文释义 1', { exact: true })).toHaveValue('人工保留的释义')
    await page.getByRole('button', { name: '查询词典', exact: true }).click()
    await expect(page.getByRole('status').first()).toContainText('查询完成')
    await expect(page.locator('.sense-card')).toHaveCount(5)
    await expect(page.getByLabel('词性 1', { exact: true })).toHaveValue('人工词性')
    await page.getByRole('button', { name: '翻译义项 4', exact: true }).click()
    await expect(page.getByLabel('中文释义 4', { exact: true })).toHaveValue('人工翻译响应：Fifth artificial definition')
    await page.getByRole('button', { name: '收藏到生词队列', exact: true }).click()
    await expect(page.getByRole('button', { name: '已收藏到本机', exact: true })).toBeDisabled()
    const reply = await page.evaluate(() => window.polarCapture.queue({ search: '', state: 'all', offset: 0 }))
    expect(reply.ok).toBe(true)
    if (reply.ok) {
      expect(reply.value.total).toBe(1)
      const event = reply.value.items[0].event
      expect(event.payload.lexicon!.senses.map(sense => sense.chinese)).toContain('人工保留的释义')
      expect(event.payload.lexicon!.removedSenseIds).toHaveLength(1)
      expect(event.payload.lexicon!.senses.map(sense => sense.id)).toEqual([...new Set(event.payload.lexicon!.senses.map(sense => sense.id))])
      expect(await page.evaluate(event => window.polarCapture.save({ id: event.id, payload: event.payload }), event)).toEqual({ ok: true, value: event.id })
    }
    await page.screenshot({ path: info.outputPath('structured-edit-saved.png'), fullPage: true })
  } finally { await app.close() }
})

test('LIVE public WiktApi + MyMemory through Electron IPC: English/German dictionary, forms and Chinese candidates', async ({}, info) => {
  test.skip(process.env.PHASE41_LIVE_DICTIONARY !== '1', 'Explicit opt-in to real public APIs and anonymous free quota.')
  const app = await launch(), results: unknown[] = []
  try {
    const page = await app.firstWindow()
    for (const [text, lang] of [['perseverance', 'en'], ['run', 'en'], ['Haus', 'de'], ['gehen', 'de']] as const) {
      const start = Date.now(), reply = await page.evaluate(({ text, lang }) => window.polarCapture.lookup({ id: crypto.randomUUID(), text, lang }), { text, lang })
      expect(reply.ok, JSON.stringify(reply)).toBe(true)
      if (!reply.ok) continue
      const { lexicon, de, warnings } = reply.value
      results.push({ text, lang, ms: Date.now() - start, senses: lexicon.senses.length, chinese: lexicon.senses.filter(sense => sense.chinese).length, parts: [...new Set(lexicon.senses.map(sense => sense.partOfSpeech))], forms: lexicon.forms.length, de, warnings })
      expect(lexicon.senses.some(sense => sense.sources.definition?.provider === 'wiktionary')).toBe(true)
      expect(lexicon.senses.some(sense => sense.chinese && sense.sources.chinese?.provider === 'mymemory')).toBe(true)
      if (text === 'run') expect(new Set(lexicon.senses.map(sense => sense.partOfSpeech)).size).toBeGreaterThan(1)
      if (text === 'Haus') expect(de).toMatchObject({ article: 'das', plural: 'Häuser' })
      if (text === 'gehen') expect(de).toMatchObject({ infinitive: 'gehen', past: 'ging', participleII: 'gegangen' })
    }
    await page.getByLabel('单词或短语', { exact: true }).fill('perseverance')
    await page.getByRole('button', { name: '查询词典', exact: true }).click()
    await expect(page.getByLabel('词性 1', { exact: true })).toHaveValue('noun', { timeout: 20000 })
    await expect(page.getByRole('status').first()).toContainText('查询完成', { timeout: 30000 })
    await expect(page.getByLabel('中文释义 1', { exact: true })).not.toHaveValue('')
    await page.screenshot({ path: info.outputPath('live-perseverance.png'), fullPage: true })
    const status = await page.evaluate(() => window.polarCapture.status()); expect(status.ok && status.value.connected).toBe(false)
  } finally { writeFileSync(join(root, 'live-results-' + Date.now() + '.json'), JSON.stringify({ at: new Date().toISOString(), source: 'Real Electron net.fetch, public APIs, artificial queries only', results }, null, 2)); await app.close() }
})
