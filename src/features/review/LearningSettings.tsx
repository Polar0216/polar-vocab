import { useState } from 'react'
import { useVocabulary, errorMessage } from '../../app/vocabulary-context'
import { Feedback } from '../../components/Feedback'
import { useLearning } from './use-learning'

export function LearningSettings() {
  const { service, settings, ready } = useVocabulary()
  const { dashboard } = useLearning()
  const [en, setEn] = useState<string | null>(null)
  const [de, setDe] = useState<string | null>(null)
  const [retention, setRetention] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null)
  async function save() {
    setBusy(true); setFeedback(null)
    try {
      await service.updateSettings({ dailyNew: { en: Number(en ?? settings!.dailyNew.en), de: Number(de ?? settings!.dailyNew.de) }, desiredRetention: Number(retention ?? settings!.desiredRetention) })
      setEn(null); setDe(null); setRetention(null)
      setFeedback({ text: '学习设置已保存。配额按今日首次学习记录计算；保持率只影响下一次评分，不重排已有到期时间或改写历史。' })
    } catch (error) { setFeedback({ text: errorMessage(error), error: true }) }
    finally { setBusy(false) }
  }
  return <section className="settings-card"><div className="settings-heading"><div><h2>FSRS 与每日学习</h2><p>ts-fsrs 5.4.2 · 词义卡 · 每次评分保留完整参数与状态。</p></div></div><form onSubmit={(event) => { event.preventDefault(); void save() }}><fieldset className="learning-settings" disabled={!ready || busy}><legend className="sr-only">学习参数</legend><label className="field"><span>英语每日新卡上限</span><input aria-label="英语每日新卡上限" type="number" min="0" max="1000" step="1" required value={en ?? settings?.dailyNew.en ?? 10} onChange={(event) => setEn(event.target.value)} /></label><label className="field"><span>德语每日新卡上限</span><input aria-label="德语每日新卡上限" type="number" min="0" max="1000" step="1" required value={de ?? settings?.dailyNew.de ?? 5} onChange={(event) => setDe(event.target.value)} /></label><label className="field"><span>目标保持率（0.70–0.99）</span><input aria-label="目标保持率" type="number" min="0.70" max="0.99" step="0.01" required value={retention ?? settings?.desiredRetention ?? 0.9} onChange={(event) => setRetention(event.target.value)} /></label><button className="button button-primary">保存学习设置</button></fieldset></form><p className="settings-footnote">新卡配额不阻止到期旧卡或当天再次到期的学习步骤。提高保持率通常增加复习负担；仅影响后续评分，不重置已有卡片或历史。其他算法参数沿用库的完整默认值。</p>{dashboard && <p className="form-help">共 {dashboard.totalCards} 张卡片，活动 {dashboard.activeCards} 张、暂停 {dashboard.suspendedCards} 张；今日评分 {dashboard.completed} 次。</p>}{feedback && <Feedback message={feedback.text} error={feedback.error} />}</section>
}
