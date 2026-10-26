import type { Lexicon } from '../../src/domain/lexicon'

export function SenseDetails({ value }: { value: Lexicon }) {
  return <details className="sense-details"><summary>结构化义项（{value.senses.length}）</summary>{value.phonetic && <p>{value.phonetic}</p>}<ol>{value.senses.map(sense => <li key={sense.id}><strong>{sense.partOfSpeech ?? '词性未指定'}</strong>{sense.chinese && <p>{sense.chinese}</p>}{sense.definition && <p lang={sense.definitionLanguage}>{sense.definition}</p>}{sense.examples.map(example => <p key={example.id}>{example.text}{example.translation ? ` — ${example.translation}` : ''}</p>)}<small>{[...new Set(Object.values(sense.sources).map(source => `${source.provider}${source.modified ? '（人工修改）' : ''}${source.license ? ` · ${source.license}` : ''}`))].join(' / ')}</small></li>)}</ol></details>
}
