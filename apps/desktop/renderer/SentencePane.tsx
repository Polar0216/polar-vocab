import { useMemo } from 'react'
import type { Language } from '../../../packages/shared'
import type { QueryMode, TextToken } from '../src/text-analysis'
import { tokenize } from '../src/text-analysis'
import type { SentenceTranslation } from '../src/sentence'

export function SentencePane({ text, lang, mode, selectedStart, translation, translationState, busy, disabled, online, keepTranslation, onKeepTranslation, onTranslate, onTranslation, onWord, onCancel }: {
  text: string; lang: Language; mode: QueryMode; selectedStart: number | null; translation: string; translationState?: SentenceTranslation;
  busy: boolean; disabled: boolean; online: boolean; keepTranslation: boolean; onKeepTranslation: (keep: boolean) => void;
  onTranslate: () => void; onTranslation: (text: string) => void; onWord: (token: TextToken) => void; onCancel: () => void;
}) {
  const tokens = useMemo(() => tokenize(text, lang), [text, lang])
  return <section className="sentence-workspace" aria-label="整句翻译与选词">
    <h2>{mode === 'phrase' ? '短语释义与选词' : '整句翻译与选词'}</h2>
    <p className="hint">点击原文中的单词查看词典。只处理你选中的文字，不读取额外上下文；句子可能交给 MyMemory 保留和处理。关闭外部查询后仍可手动填写、选词和收藏。</p>
    <div className="sentence-columns"><div className="sentence-original"><h3>原文 · 点击选词</h3><div className="interactive-sentence" data-testid="interactive-source">{tokens.map(token => token.word ? <button type="button" key={token.start} aria-label={`查词 ${token.text}`} aria-pressed={selectedStart === token.start} disabled={disabled} onClick={() => onWord(token)}>{token.text}</button> : <span key={token.start}>{token.text}</span>)}</div></div>
      <label className="sentence-chinese">中文译文<textarea aria-label="整句中文译文" rows={6} maxLength={20000} value={translation} disabled={disabled} onChange={event => onTranslation(event.target.value)} placeholder="可手动输入，网络失败不会丢失原文。" /></label></div>
    <div className="actions"><button type="button" disabled={disabled || !online || busy || !text.trim()} onClick={onTranslate}>翻译所选文本</button>{busy && <button type="button" onClick={onCancel}>取消整句翻译</button>}</div>
    <p role="status" className="hint">{busy ? '正在异步翻译，可继续选词…' : translationState?.warning || (translation ? '译文已保留，可核对修改。' : '尚未取得译文，可直接选词。')}</p>
    <label className="check"><input type="checkbox" checked={keepTranslation} disabled={disabled || !translation.trim() || translationState?.complete === false} onChange={event => onKeepTranslation(event.target.checked)} />收藏时保留已核对的句子译文</label>
    {translationState && !translationState.complete && <p className="hint">部分译文尚不完整。可手动补齐后再选择保留，原句始终可随单词收藏。</p>}
  </section>
}
