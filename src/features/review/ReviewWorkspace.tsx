import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Language, ReviewRating, VocabularyEntry } from '../../domain'
import { useVocabulary, errorMessage } from '../../app/vocabulary-context'
import { PageHeader } from '../../components/PageHeader'
import { Feedback } from '../../components/Feedback'
import { EntryEditor } from '../vocabulary/EntryEditor'
import { displayLemma } from '../vocabulary/entry-ui'
import { cardEligible, type StudyItem } from './daily-tasks'
import { loadReviewService } from './client'
import { useLearning } from './use-learning'

const ratings: { value: ReviewRating; description: string; key: string }[] = [
  { value: 'Again', description: '没有回忆出来', key: '1' }, { value: 'Hard', description: '回忆困难', key: '2' },
  { value: 'Good', description: '正常回忆', key: '3' }, { value: 'Easy', description: '轻松回忆', key: '4' },
]
const states = ['New · 尚未学习', 'Learning · 学习中', 'Review · 间隔复习', 'Relearning · 重新学习']
const localTime = (time: string) => new Date(time).toLocaleString('zh-CN')

export function ReviewPage() {
  const { service, ready } = useVocabulary()
  const { dashboard, error, refresh } = useLearning()
  const [language, setLanguage] = useState<Language | 'all'>('all')
  const [running, setRunning] = useState(false)
  const [current, setCurrent] = useState<{ item: StudyItem; eventId: string } | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null)
  const [detail, setDetail] = useState<VocabularyEntry | null>(null)
  const [cardLimit, setCardLimit] = useState(50)
  const [historyCard, setHistoryCard] = useState('')
  const [historyLimit, setHistoryLimit] = useState(50)
  const latest = dashboard?.cards.find((item) => item.card.id === current?.item.card.id)
  const changed = !!current && (!latest || latest.card.stateId !== current.item.card.stateId || latest.card.revisionId !== current.item.card.revisionId || !cardEligible(latest.entry, latest.card))
  const entry = latest?.entry ?? current?.item.entry
  function select(item: StudyItem | undefined) { setCurrent(item ? { item, eventId: crypto.randomUUID() } : null); setRevealed(false) }
  async function start() {
    if (lock.current) return
    lock.current = true; setBusy(true); setFeedback(null)
    try { const data = await (await loadReviewService(service)).dashboard(); select(data.queue.find((item) => language === 'all' || item.entry.lang === language)); setRunning(true); refresh() }
    catch (failure) { setFeedback({ text: errorMessage(failure), error: true }) }
    finally { lock.current = false; setBusy(false) }
  }
  async function grade(rating: ReviewRating) {
    if (!current || !revealed || changed || lock.current) return
    lock.current = true; setBusy(true); setFeedback(null)
    let saved = false
    try {
      const review = await loadReviewService(service)
      const result = await review.grade({ eventId: current.eventId, cardId: current.item.card.id, expectedRevisionId: current.item.card.revisionId, expectedStateId: current.item.card.stateId, rating })
      saved = true
      setFeedback({ text: '评分已保存到本机 · ' + rating + ' · 下次到期 ' + localTime(result.card.fsrsState.due) })
      const next = await review.dashboard(); select(next.queue.find((item) => language === 'all' || item.entry.lang === language)); refresh()
    } catch (failure) {
      if (saved) { select(undefined); setRunning(false) }
      setFeedback({ text: (saved ? '评分已保存，但后续任务读取失败：' : '评分未确认成功，当前卡片保留：') + errorMessage(failure), error: true }); refresh()
    } finally { lock.current = false; setBusy(false) }
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || document.querySelector('[role="dialog"]') || target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (!current || busy || changed) return
      if (event.code === 'Space' && !revealed) { event.preventDefault(); setRevealed(true) }
      const rating = ratings.find((item) => item.key === event.key)
      if (rating && revealed) { event.preventDefault(); void grade(rating.value) }
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  })
  async function suspend(item: StudyItem) {
    if (lock.current) return
    lock.current = true; setBusy(true)
    try { await (await loadReviewService(service)).setSuspended(item.card.id, !item.card.suspended, item.card.revisionId); setFeedback({ text: '卡片管理状态已保存，原调度和历史保留。' }); refresh() }
    catch (failure) { setFeedback({ text: errorMessage(failure), error: true }) }
    finally { lock.current = false; setBusy(false) }
  }
  const tasks = dashboard?.queue.filter((item) => language === 'all' || item.entry.lang === language) ?? []
  const cards = dashboard?.cards.filter((item) => language === 'all' || item.entry.lang === language) ?? []
  const history = dashboard?.history.filter((event) => (!historyCard || event.cardId === historyCard) && (language === 'all' || dashboard.historyLabels[event.cardId]?.lang === language)) ?? []
  return <>
    <PageHeader eyebrow="让记忆，循序发生" title="复习" description="先回忆，再翻卡。真实 FSRS 调度，评分和历史先保存到本机。" />
    {(feedback || error) && <Feedback message={error ?? feedback!.text} error={!!error || feedback?.error} />}
    {!ready || !dashboard ? <p role="status">{error ? '任务读取失败，请保留数据后重试。' : '正在读取本机卡片和复习记录…'}</p> : <>
      <section className="review-summary" aria-label="今日学习任务"><div><strong aria-label="今日到期卡片">{dashboard.due}</strong><span>现在到期</span></div><div><strong aria-label="今日可学新卡">{dashboard.availableNew}</strong><span>可学新卡</span></div><div><strong aria-label="今日完成次数">{dashboard.completed}</strong><span>今日评分次数</span></div><div><strong>{dashboard.reviewedCards}</strong><span>今日独立卡片</span></div></section>
      <p className="form-help">按 {dashboard.timeZone} 本地日历日 {dashboard.day} 统计。到期旧卡优先，新卡配额只计首次学习；学习步骤再次到期后可继续。</p>
      <div className="review-toolbar"><label className="field"><span>学习语言</span><select aria-label="学习语言" value={language} disabled={busy} onChange={(event) => { setLanguage(event.target.value as Language | 'all'); setRunning(false); select(undefined) }}><option value="all">英德混合</option><option value="en">仅英语</option><option value="de">仅德语</option></select></label>{(['en', 'de'] as const).map((lang) => <span key={lang}>{lang === 'en' ? '英语' : '德语'} · 到期 {dashboard.languages[lang].due} / 新卡 {dashboard.languages[lang].availableNew} / 完成 {dashboard.languages[lang].events} 次</span>)}</div>
      {!running && <section className="study-card study-empty"><h2>按自己的节奏开始</h2><p>本次可处理 {tasks.length} 张卡片。收集或标记已整理都不会自动加入复习。</p><button className="button button-primary" disabled={busy || !tasks.length} onClick={() => void start()}>开始复习</button><Link to="/vocabulary" className="button button-secondary">前往词库加入复习</Link></section>}
      {running && current && entry && <section className="study-card" aria-label="当前学习卡片">
        <div className="study-meta"><span className={'entry-language ' + entry.lang}>{entry.lang.toUpperCase()}</span><span>{states[current.item.card.fsrsState.state]}</span></div><h2 className="study-word">{displayLemma(entry)}</h2>{entry.partOfSpeech && <p className="form-help">{entry.partOfSpeech}</p>}
        {changed && <Feedback message="另一页面已更新、暂停或移除这张卡片。请重新读取任务，旧状态不能评分。" error />}
        {!revealed ? <><p className="form-help">在心里回忆中文含义，再查看答案。</p><button className="button button-primary reveal-button" disabled={busy || changed} onClick={() => setRevealed(true)}>显示答案</button></> : <>
          <div className="study-answer" aria-label="卡片答案"><h3>中文释义</h3><ul>{entry.meanings?.map((meaning, index) => <li key={index}>{meaning}</li>)}</ul>{entry.contexts?.map((context) => <blockquote key={context.id}>{context.text}{context.source && <small>{context.source}</small>}</blockquote>)}
            {entry.lang === 'en' && <><AnswerList title="常见搭配" values={entry.en?.collocations} /><AnswerList title="词形变化" values={entry.en?.inflections} /><AnswerList title="派生词" values={entry.en?.derivatives} />{entry.en?.phonetic && <p>音标：{entry.en.phonetic}</p>}</>}
            {entry.lang === 'de' && entry.de && <><p>{[entry.de.article && '冠词 ' + entry.de.article, entry.de.plural && '复数 ' + entry.de.plural, entry.de.infinitive, entry.de.past, entry.de.participleII, entry.de.auxiliary, entry.de.separablePrefix].filter(Boolean).join(' · ')}</p>{entry.de.conjugations?.map((form, index) => <p key={index}>{form.tense} · {form.person} · {form.form}</p>)}<AnswerList title="格支配" values={entry.de.government} /><AnswerList title="复合词" values={entry.de.compoundParts} /><p>{[entry.de.comparative, entry.de.superlative, entry.de.notes].filter(Boolean).join(' · ')}</p></>}{entry.source && <p className="form-help">来源：{entry.source}</p>}
          </div><div className="rating-grid">{ratings.map((rating) => <button key={rating.value} className={'rating-button rating-' + rating.value.toLowerCase()} disabled={busy || changed} onClick={() => void grade(rating.value)}><strong>{rating.value}</strong><span>{rating.description}</span><kbd>{rating.key}</kbd></button>)}</div>
        </>}
        <div className="study-actions"><button className="button button-secondary" disabled={busy} onClick={() => setDetail(entry)}>词条详情</button><button className="button button-secondary" disabled={busy} onClick={() => { setRunning(false); select(undefined) }}>暂停当前学习</button>{changed && <button className="button button-primary" disabled={busy} onClick={() => void start()}>重新读取任务</button>}</div><p className="form-help">空格翻卡，数字 1–4 评分。输入框或详情弹窗内不会触发快捷键。提交完成后才进入下一张。</p>
      </section>}
      {running && !current && <section className="study-card study-empty"><h2>{tasks.length ? '有到期任务，可以继续学习' : '目前没有可继续的任务'}</h2><p>{tasks.length ? '已从本机状态重新找到 ' + tasks.length + ' 张任务，请继续学习。' : dashboard.nextLearningAt ? '学习步骤下次到期：' + localTime(dashboard.nextLearningAt) + '。到期后可继续，不会被当天新卡额度拦住。' : '当前到期与可用新卡已经处理完；以后的卡片仍按 FSRS 时间安排。'}</p><button className="button button-primary" disabled={busy || !tasks.length} onClick={() => void start()}>继续学习</button><button className="button button-secondary" onClick={() => { setRunning(false); window.dispatchEvent(new Event('polar-vocab-session-ended')) }}>结束本次学习</button></section>}
      <section className="manager-card" aria-label="卡片管理"><h2>记忆卡片</h2><p className="form-help">{cards.length} 张当前语言卡片；暂停是管理状态，不改变 FSRS 状态。</p><ul className="review-card-list">{cards.slice(0, cardLimit).map((item) => <li key={item.card.id}><div><strong>{displayLemma(item.entry)}</strong><p>{item.card.suspended ? 'Suspended · 已暂停' : states[item.card.fsrsState.state]} · {item.card.template === 'meaning' ? '词义卡' : '预留模板'}</p><p>下次到期：{localTime(item.card.fsrsState.due)}</p>{!cardEligible(item.entry, item.card) && !item.card.suspended && <p className="form-help">词条状态、释义或算法不符合当前活动任务条件。</p>}{dashboard.blockedCards.includes(item.card.id) && <p role="alert">存在未解决的复习分支，已停止调度。</p>}</div><div className="entry-actions"><button className="button button-secondary" disabled={busy} onClick={() => void suspend(item)} aria-label={(item.card.suspended ? '恢复卡片 ' : '暂停卡片 ') + item.entry.lemma}>{item.card.suspended ? '恢复卡片' : '暂停卡片'}</button><button className="button button-quiet" onClick={() => setDetail(item.entry)}>原始词条</button><button className="button button-quiet" onClick={() => { setHistoryCard(item.card.id); setHistoryLimit(50) }}>查看历史</button></div></li>)}</ul>{!cards.length && <p className="form-help">还没有卡片；到词库选择已整理、有释义的词条加入复习。</p>}{cards.length > cardLimit && <button className="button button-secondary" onClick={() => setCardLimit((value) => value + 50)}>显示更多卡片</button>}</section>
      <section className="manager-card" aria-label="复习历史"><h2>复习历史</h2><label className="field"><span>历史卡片</span><select aria-label="历史卡片" value={historyCard} onChange={(event) => { setHistoryCard(event.target.value); setHistoryLimit(50) }}><option value="">全部卡片（含删除历史）</option>{Object.entries(dashboard.historyLabels).map(([id, label]) => <option value={id} key={id}>{label.lemma}{label.deleted ? '（已删除）' : ''}</option>)}</select></label><p className="form-help">独立事件永久保留；同一张卡片可有多次评分。显示 {Math.min(history.length, historyLimit)} / {history.length} 次。</p><ol className="review-history">{history.slice(0, historyLimit).map((event) => <li key={event.id}><strong>{dashboard.historyLabels[event.cardId]?.lemma ?? '历史词条'}{dashboard.historyLabels[event.cardId]?.deleted ? '（已删除）' : ''}</strong><span>{event.rating} · {localTime(event.reviewedAt)}</span><small>下次到期 {localTime(event.afterState.due)} · 第 {event.afterState.reps} 次 · {event.schedulerVersion}</small></li>)}</ol>{!history.length && <p className="form-help">尚未产生复习事件。</p>}{history.length > historyLimit && <button className="button button-secondary" onClick={() => setHistoryLimit((value) => value + 50)}>显示更多历史</button>}</section>
    </>}
    {detail && <EntryEditor entry={detail} onClose={() => setDetail(null)} />}
  </>
}
function AnswerList({ title, values }: { title: string; values?: string[] }) {
  return values?.length ? <div><h3>{title}</h3><ul>{values.map((value, index) => <li key={index}>{value}</li>)}</ul></div> : null
}
