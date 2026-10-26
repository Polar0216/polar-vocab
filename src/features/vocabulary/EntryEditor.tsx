import { useState, type FormEvent } from 'react'
import { SenseEditor } from '../../../packages/shared/SenseEditor'
import { cleanLexicon, editedSource, senseMeanings } from '../../../packages/shared/lexicon'
import type { EnglishFields, GermanFields, GermanConjugation, VocabularyContext, VocabularyEntry, VocabularyPayload } from '../../domain'
import { useVocabulary, errorMessage } from '../../app/vocabulary-context'
import { Dialog } from '../../components/Dialog'
import { Feedback } from '../../components/Feedback'
import { splitTags, displayLemma, statusLabels } from './entry-ui'

function TextList({ label, values, onChange, multiline = false, maxLength = 4000 }: { label: string; values: string[]; onChange: (values: string[]) => void; multiline?: boolean; maxLength?: number }) {
  return <div className="field list-field"><span>{label}</span>{values.map((value, index) => <div className="repeatable-field" key={index}>{multiline ? <textarea aria-label={`${label} ${index + 1}`} value={value} onChange={(event) => onChange(values.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} rows={2} maxLength={maxLength} /> : <input aria-label={`${label} ${index + 1}`} value={value} onChange={(event) => onChange(values.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} maxLength={maxLength} />}<button type="button" className="button button-quiet" aria-label={`移除${label} ${index + 1}`} onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}>移除</button></div>)}<button type="button" className="button button-secondary add-field" onClick={() => onChange([...values, ''])}>添加{label}</button></div>
}

export function EntryEditor({ entry, onClose, onSaved }: { entry: VocabularyEntry; onClose: () => void; onSaved?: () => void }) {
  const { service } = useVocabulary()
  const [lemma, setLemma] = useState(entry.lemma)
  const [lexicon, setLexicon] = useState(entry.lexicon)
  const [meanings, setMeanings] = useState(entry.meanings ?? [])
  const [contexts, setContexts] = useState<VocabularyContext[]>(entry.contexts ?? [])
  const [source, setSource] = useState(entry.source ?? '')
  const [tags, setTags] = useState((entry.tags ?? []).join(', '))
  const [partOfSpeech, setPartOfSpeech] = useState(entry.partOfSpeech ?? '')
  const [status, setStatus] = useState(entry.status)
  const [english, setEnglish] = useState<EnglishFields>(entry.lang === 'en' ? entry.en ?? {} : {})
  const [german, setGerman] = useState<GermanFields>(entry.lang === 'de' ? entry.de ?? {} : {})
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null)
  const noun = /名词|noun|^n\.?$/iu.test(partOfSpeech)
  const verb = /动词|verb|^v\.?$/iu.test(partOfSpeech)
  const adjective = /形容词|副词|adj|adv/iu.test(partOfSpeech)
  const preposition = /介词|prep/iu.test(partOfSpeech)

  const enValue = (field: keyof EnglishFields, value: string | string[]) => { setEnglish(previous => ({ ...previous, [field]: value })); setLexicon(previous => previous ? { ...previous, ...(field === 'phonetic' ? { phonetic: value as string } : {}), fieldSources: { ...previous.fieldSources, [field === 'phonetic' ? field : 'en.' + field]: editedSource(previous.fieldSources[field === 'phonetic' ? field : 'en.' + field]) } } : previous) }
  const deValue = <K extends keyof GermanFields>(field: K, value: GermanFields[K]) => { setGerman(previous => ({ ...previous, [field]: value })); setLexicon(previous => previous ? { ...previous, fieldSources: { ...previous.fieldSources, ['de.' + field]: editedSource(previous.fieldSources['de.' + field]) } } : previous) }

  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setFeedback(null)
    try {
      const cleanObject = <T extends object>(object: T): T => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== '' && value !== undefined).map(([key, value]) => [key, Array.isArray(value) && value.every((item) => typeof item === 'string') ? value.map((item) => item.trim()).filter(Boolean) : value])) as T
      const structured = lexicon ? cleanLexicon(lexicon) : undefined
      const common = { lemma: lemma.trim(), ...(entry.encounteredForm ? { encounteredForm: entry.encounteredForm } : {}), ...(entry.lemmaResolution?.lemma === lemma.trim() ? { lemmaResolution: entry.lemmaResolution } : {}), ...(structured ? { lexicon: structured } : {}), meanings: structured ? senseMeanings(structured) : meanings.map((value) => value.trim()).filter(Boolean), contexts: contexts.filter((value) => value.text.trim()).map((value) => ({ ...value, text: value.text.trim(), translation: value.translation?.trim() || undefined, ...(value.source?.trim() ? { source: value.source.trim() } : { source: undefined }) })), source: source.trim() || undefined, tags: splitTags(tags), partOfSpeech: structured ? undefined : partOfSpeech.trim() || undefined }
      const payload: VocabularyPayload = entry.lang === 'en' ? { ...common, lang: 'en', en: cleanObject(english) } : { ...common, lang: 'de', de: cleanObject(german) }
      await service.update(entry.id, { ...payload, status }, { expectedRevisionId: entry.revisionId })
      onSaved?.()
      onClose()
    } catch (error) { setFeedback({ text: `${errorMessage(error)} 输入内容已保留。`, error: true }) }
    finally { setBusy(false) }
  }

  function conjugation(index: number, patch: Partial<GermanConjugation>) { deValue('conjugations', (german.conjugations ?? []).map((value, itemIndex) => itemIndex === index ? { ...value, ...patch } : value)) }
  return <Dialog title={`编辑 · ${displayLemma(entry)}`} onClose={() => { if (!busy) onClose() }}><form onSubmit={(event) => void save(event)} className="entry-form editor-form">
    <p className="form-help">{entry.lang === 'en' ? '英语' : '德语'}词条 · 所有补充字段选填。语言作为记录身份固定；如需换语言，请新建词条。</p>
    {entry.encounteredForm && <p className="form-help">遇到的词形：{entry.encounteredForm}{entry.lemmaResolution ? ` · 词典原型：${entry.lemmaResolution.lemma} · ${entry.lemmaResolution.tags.join(" / ")} · ${entry.lemmaResolution.source.provider}` : " · 未确认原型关系"}</p>}
    <div className="form-grid"><label className="field"><span>词条原形 <em>必填</em></span><input value={lemma} onChange={(event) => setLemma(event.target.value)} maxLength={500} required /></label>{!lexicon && <label className="field"><span>词性</span><input list="part-of-speech" value={partOfSpeech} onChange={(event) => setPartOfSpeech(event.target.value)} placeholder="如 名词 / 动词 / 介词" maxLength={100} /><datalist id="part-of-speech"><option value="名词" /><option value="动词" /><option value="形容词" /><option value="副词" /><option value="介词" /><option value="短语" /></datalist></label>}<label className="field"><span>整理状态</span><select value={status} onChange={(event) => setStatus(event.target.value as VocabularyEntry['status'])}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="field"><span>来源</span><input value={source} onChange={(event) => setSource(event.target.value)} maxLength={2000} /></label><label className="field full-width"><span>标签</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="多个标签用逗号分隔" /></label></div>
    {lexicon ? <SenseEditor value={lexicon} onChange={setLexicon} disabled={busy} /> : <TextList label="释义" values={meanings} onChange={setMeanings} multiline />}
    {lexicon?.phonetic && <p>词典音标：{lexicon.phonetic}</p>}
    {!!lexicon?.forms.length && <details><summary>词典词形与来源</summary>{lexicon.forms.map(form => <p key={form.id}>{form.partOfSpeech} · {form.form} · {form.tags.join(" / ")} · Wiktionary / CC-BY-SA-4.0</p>)}</details>}
    <div className="field list-field"><span>原句与来源</span>{contexts.map((value, index) => <div className="context-editor" key={value.id}><label className="field"><span>原句 {index + 1}</span><textarea value={value.text} onChange={(event) => setContexts(contexts.map((item) => item.id === value.id ? { ...item, text: event.target.value } : item))} rows={2} maxLength={20000} /></label><label className="field"><span>原句来源 {index + 1}</span><input value={value.source ?? ''} onChange={(event) => setContexts(contexts.map((item) => item.id === value.id ? { ...item, source: event.target.value } : item))} maxLength={2000} /></label><label className="field"><span>原句译文 {index + 1}</span><textarea value={value.translation ?? ""} maxLength={20000} rows={2} onChange={event => setContexts(contexts.map(item => item.id === value.id ? { ...item, translation: event.target.value, translationLanguage: "zh-CN", translationSource: editedSource(item.translationSource) } : item))} /></label>{value.translationSource && <p className="form-help">译文来源：{value.translationSource.provider}{value.translationSource.modified ? "（人工修改）" : ""}</p>}<button type="button" className="button button-quiet" onClick={() => setContexts(contexts.filter((item) => item.id !== value.id))}>移除原句 {index + 1}</button></div>)}<button type="button" className="button button-secondary add-field" onClick={() => setContexts([...contexts, { id: crypto.randomUUID(), text: '' }])}>添加原句</button></div>

    {entry.lang === 'en' && <details className="optional-fields" open><summary>英语词形与搭配</summary><div className="form-grid"><label className="field"><span>音标</span><input value={english.phonetic ?? ''} onChange={(event) => enValue('phonetic', event.target.value)} maxLength={200} /></label><label className="field"><span>发音资源 URL（HTTPS）</span><input type="url" value={english.pronunciationUrl ?? ''} onChange={(event) => enValue('pronunciationUrl', event.target.value)} /></label></div><TextList label="常见搭配" values={english.collocations ?? []} onChange={(values) => enValue('collocations', values)} maxLength={500} /><TextList label="词形变化" values={english.inflections ?? []} onChange={(values) => enValue('inflections', values)} maxLength={500} /><TextList label="派生词" values={english.derivatives ?? []} onChange={(values) => enValue('derivatives', values)} maxLength={500} /></details>}

    {entry.lang === 'de' && <>
      <details className="optional-fields" open={noun || Boolean(german.article || german.plural)}><summary>名词 · 冠词与复数</summary><div className="form-grid"><label className="field"><span>定冠词</span><select value={german.article ?? ''} onChange={(event) => deValue('article', (event.target.value || undefined) as GermanFields['article'])}><option value="">暂不填写</option><option>der</option><option>die</option><option>das</option></select></label><label className="field"><span>复数</span><input value={german.plural ?? ''} onChange={(event) => deValue('plural', event.target.value)} maxLength={500} /></label></div></details>
      <details className="optional-fields" open={verb || Boolean(german.infinitive || german.past || german.participleII || german.conjugations?.length)}><summary>动词 · 主要词形与变位</summary><div className="form-grid">{([['infinitive', '不定式'], ['past', '过去式'], ['participleII', '第二分词'], ['separablePrefix', '可分前缀']] as const).map(([field, label]) => <label className="field" key={field}><span>{label}</span><input value={german[field] ?? ''} onChange={(event) => deValue(field, event.target.value)} maxLength={field === 'separablePrefix' ? 100 : 500} /></label>)}<label className="field"><span>助动词</span><select value={german.auxiliary ?? ''} onChange={(event) => deValue('auxiliary', (event.target.value || undefined) as GermanFields['auxiliary'])}><option value="">暂不填写</option><option>haben</option><option>sein</option></select></label></div>
        {(german.conjugations ?? []).map((value, index) => <div className="conjugation-row" key={index}><label className="field"><span>时态 {index + 1}</span><input value={value.tense} onChange={(event) => conjugation(index, { tense: event.target.value })} placeholder="Präsens" maxLength={100} required /></label><label className="field"><span>人称 {index + 1}</span><select value={value.person} onChange={(event) => conjugation(index, { person: event.target.value as GermanConjugation['person'] })}>{['ich', 'du', 'er-sie-es', 'wir', 'ihr', 'sie-Sie'].map((person) => <option key={person}>{person}</option>)}</select></label><label className="field"><span>变位 {index + 1}</span><input value={value.form} onChange={(event) => conjugation(index, { form: event.target.value })} maxLength={500} required /></label><button type="button" className="button button-quiet" onClick={() => deValue('conjugations', (german.conjugations ?? []).filter((_, itemIndex) => index !== itemIndex))}>移除</button></div>)}<button type="button" className="button button-secondary" onClick={() => deValue('conjugations', [...(german.conjugations ?? []), { tense: 'Präsens', person: 'ich', form: '' }])}>添加变位</button>
      </details>
      <details className="optional-fields" open={preposition || verb || Boolean(german.government?.length)}><summary>介词与动词 · 格支配</summary><div className="checkbox-options">{([['nominative', '第一格 Nominativ'], ['accusative', '第四格 Akkusativ'], ['dative', '第三格 Dativ'], ['genitive', '第二格 Genitiv']] as const).map(([value, label]) => <label key={value}><input type="checkbox" checked={german.government?.includes(value) ?? false} onChange={(event) => deValue('government', event.target.checked ? [...(german.government ?? []), value] : (german.government ?? []).filter((item) => item !== value))} />{label}</label>)}</div></details>
      <details className="optional-fields" open={adjective || Boolean(german.comparative || german.superlative)}><summary>形容词与副词 · 比较级</summary><div className="form-grid"><label className="field"><span>比较级</span><input value={german.comparative ?? ''} onChange={(event) => deValue('comparative', event.target.value)} maxLength={500} /></label><label className="field"><span>最高级</span><input value={german.superlative ?? ''} onChange={(event) => deValue('superlative', event.target.value)} maxLength={500} /></label></div></details>
      <details className="optional-fields" open={Boolean(german.compoundParts?.length || german.notes)}><summary>复合词与备注</summary><TextList label="复合词组成" values={german.compoundParts ?? []} onChange={(values) => deValue('compoundParts', values)} maxLength={500} /><label className="field"><span>备注</span><textarea value={german.notes ?? ''} onChange={(event) => deValue('notes', event.target.value)} maxLength={4000} rows={3} /></label></details>
    </>}
    <p className="form-help">「已整理」不会自动创建卡片。保存后，可在词库明确选择加入复习；修改释义不会重置已有学习历史。</p>
    {feedback && <Feedback message={feedback.text} error={feedback.error} />}
    <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>取消</button><button className="button button-primary" disabled={busy || !lemma.trim()}>{busy ? '正在保存…' : '保存修改'}</button></div>
  </form></Dialog>
}
