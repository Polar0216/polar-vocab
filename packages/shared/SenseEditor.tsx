import type { Lexicon } from '../../src/domain/lexicon'
import { editSense, editedSource, manualSense } from './lexicon'

export function SenseEditor({ value, onChange, disabled = false, onTranslate, translatingIds = [] }: { value: Lexicon; onChange: (value: Lexicon) => void; disabled?: boolean; onTranslate?: (id: string) => void; translatingIds?: string[] }) {
  return <section className="sense-editor" aria-label="结构化义项"><h3>义项 <small>({value.senses.length})</small></h3>
    {value.senses.map((sense, index) => <fieldset key={sense.id} className="sense-card" disabled={disabled}><legend>义项 {index + 1} {sense.partOfSpeech && <span className="badge">{sense.partOfSpeech}</span>}</legend>
      {(['partOfSpeech', 'chinese', 'definition'] as const).map(field => <label className="field" key={field}><span>{{ partOfSpeech: '词性', chinese: '中文释义', definition: '原文释义' }[field]}{field === 'definition' && sense.definitionLanguage ? ` (${sense.definitionLanguage})` : ''}</span>
        {field === 'partOfSpeech' ? <input aria-label={`词性 ${index + 1}`} maxLength={100} value={sense[field] ?? ''} placeholder="noun / verb / phrase（可留空）" onChange={event => onChange({ ...value, senses: value.senses.map(item => item.id === sense.id ? editSense(item, field, event.target.value) : item) })} /> : <textarea aria-label={`${field === 'chinese' ? '中文释义' : '原文释义'} ${index + 1}`} maxLength={4000} rows={2} value={sense[field] ?? ''} onChange={event => onChange({ ...value, senses: value.senses.map(item => item.id === sense.id ? editSense(item, field, event.target.value) : item) })} />}
      </label>)}
      {onTranslate && !sense.chinese && sense.definition && <button type="button" disabled={translatingIds.includes(sense.id)} onClick={() => onTranslate(sense.id)}>{translatingIds.includes(sense.id) ? '正在翻译…' : `翻译义项 ${index + 1}`}</button>}
      {sense.examples.map((example, exampleIndex) => <div key={example.id} className="sense-example">{(['text', 'translation'] as const).map(field => <label className="field" key={field}><span>{field === 'text' ? '例句' : `例句译文 ${example.translationLanguage ?? '（语言未指定）'}`}</span><textarea aria-label={`${field === 'text' ? '例句' : '例句译文'} ${index + 1}.${exampleIndex + 1}`} value={example[field] ?? ''} maxLength={2000} rows={2} onChange={event => onChange({ ...value, senses: value.senses.map(item => item.id === sense.id ? { ...item, examples: item.examples.map(e => e.id === example.id ? { ...e, [field]: event.target.value, sources: { ...e.sources, [field]: editedSource(e.sources[field]) } } : e) } : item) })} /></label>)}</div>)}
      <p className="hint form-help">{Object.entries(sense.sources).map(([field, source]) => <span key={field}>{({ partOfSpeech: '词性', chinese: '中文', definition: '原文' } as Record<string, string>)[field] ?? field}：{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.provider}</a> : source.provider}{source.modified ? '（人工修改）' : ''}{source.license ? ` · ${source.license}` : ''} </span>)}</p>
      <button type="button" className="button button-quiet" onClick={() => onChange({ ...value, senses: value.senses.filter(item => item.id !== sense.id), removedSenseIds: [...new Set([...value.removedSenseIds, sense.id])].slice(-256) })}>删除义项 {index + 1}</button>
    </fieldset>)}
    {!value.senses.length && <p className="hint">未获取到义项，可手动添加。短语无需填写词性。</p>}
    <button type="button" className="button button-secondary" disabled={disabled || value.senses.length >= 64} onClick={() => onChange({ ...value, senses: [...value.senses, manualSense()] })}>新增义项</button>
  </section>
}
