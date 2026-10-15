import { useState, type FormEvent } from 'react'
import type { Language, VocabularyEntry, VocabularyPayload } from '../../domain'
import { useVocabulary, errorMessage } from '../../app/vocabulary-context'
import { Feedback } from '../../components/Feedback'
import { splitTags, displayLemma } from './entry-ui'

export function QuickAdd({ onView }: { onView?: (entry: VocabularyEntry) => void }) {
  const { service, ready, defaultLanguage } = useVocabulary()
  const [language, setLanguage] = useState<Language>(defaultLanguage)
  const [lemma, setLemma] = useState('')
  const [meaning, setMeaning] = useState('')
  const [context, setContext] = useState('')
  const [source, setSource] = useState('')
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null)
  const [duplicates, setDuplicates] = useState<VocabularyEntry[]>([])

  function payload(): VocabularyPayload {
    return { lang: language, lemma: lemma.trim(), ...(meaning.trim() ? { meanings: [meaning.trim()] } : {}), ...(context.trim() ? { contexts: [{ id: crypto.randomUUID(), text: context.trim(), ...(source.trim() ? { source: source.trim() } : {}) }] } : {}), ...(source.trim() ? { source: source.trim() } : {}), ...(tags.trim() ? { tags: splitTags(tags) } : {}) }
  }

  async function save(allowDuplicate = false) {
    setBusy(true); setFeedback(null)
    try {
      const input = payload()
      if (!allowDuplicate) {
        const found = await service.findDuplicates(input)
        if (found.length) { setDuplicates(found); return }
      }
      const entry = await service.add(input, { allowDuplicate })
      setLemma(''); setMeaning(''); setContext(''); setSource(''); setTags(''); setDuplicates([])
      setFeedback({ text: `「${entry.lemma}」已保存到本机生词箱。待同步操作已保留，请在设置查看云端确认状态。` })
    } catch (error) { setFeedback({ text: errorMessage(error), error: true }) }
    finally { setBusy(false) }
  }

  const submit = (event: FormEvent) => { event.preventDefault(); void save() }
  return <section className="capture-card" aria-label="快速添加生词"><div className="capture-heading"><h2>收下一个新词</h2><p>只填词形和语言，也可以保存。</p></div><form onSubmit={submit} className="entry-form">
    <div className="quick-add-primary"><label className="field"><span>单词或短语 <em>必填</em></span><input aria-label="单词或短语" placeholder="留下刚刚遇见的词…" value={lemma} onChange={(event) => { setLemma(event.target.value); setDuplicates([]) }} required maxLength={500} autoComplete="off" /></label><label className="field language-field"><span>语言</span><select aria-label="录入语言" value={language} onChange={(event) => { setLanguage(event.target.value as Language); setDuplicates([]) }}><option value="en">英语 · EN</option><option value="de">德语 · DE</option></select></label><button className="button button-primary quick-save" type="submit" disabled={!ready || busy || !lemma.trim()}>{busy ? '正在保存…' : '保存生词'}</button></div>
    <details className="optional-fields"><summary>补充释义、原句和标签（选填）</summary><div className="form-grid"><label className="field"><span>中文释义</span><textarea value={meaning} onChange={(event) => setMeaning(event.target.value)} maxLength={4000} rows={2} /></label><label className="field"><span>原句</span><textarea value={context} onChange={(event) => setContext(event.target.value)} maxLength={20000} rows={2} /></label><label className="field"><span>来源</span><input value={source} onChange={(event) => setSource(event.target.value)} maxLength={2000} /></label><label className="field"><span>标签</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="多个标签用逗号分隔" /></label></div></details>
    {duplicates.length > 0 && <div className="duplicate-notice" role="status"><strong>发现 {duplicates.length} 条可能重复的词条</strong><p>已有释义和原句会完整保留。你可以查看已有词条，或另存一条。</p>{duplicates.map((entry) => <button type="button" className="button button-secondary" key={entry.id} onClick={() => onView?.(entry)} disabled={!onView}>{displayLemma(entry)} · 查看已有词条</button>)}<div className="inline-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => void save(true)}>仍然新增独立词条</button><button type="button" className="button button-quiet" onClick={() => setDuplicates([])}>取消新增</button></div></div>}
    {feedback && <Feedback message={feedback.text} error={feedback.error} />}
  </form></section>
}
