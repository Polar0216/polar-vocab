import { Link } from 'react-router-dom'
import { useLearning } from './use-learning'
import { useVocabulary } from '../../app/vocabulary-context'

export function LearningOverview() {
  const { dashboard, error } = useLearning()
  const { stats } = useVocabulary()
  return <section className="manager-card" aria-label="真实学习统计"><div className="manager-heading"><div><h2>今日学习</h2><p>{dashboard ? dashboard.day + ' · ' + dashboard.timeZone : error ?? '正在读取卡片和历史…'}</p></div><Link className="button button-primary" to="/review">打开复习</Link></div><p className="form-help">总词汇数量：<strong aria-label="总词汇数量">{stats ? stats.en + stats.de : '—'}</strong> 条（独立词条，与卡片及评分次数分开）。</p>
    {dashboard && <><dl className="learning-stat-grid"><div><dt>活动卡片</dt><dd aria-label="活动卡片数">{dashboard.activeCards}</dd></div><div><dt>现在待复习</dt><dd>{dashboard.due}</dd></div><div><dt>今日评分次数</dt><dd>{dashboard.completed}</dd></div><div><dt>今日新学习卡片</dt><dd>{dashboard.newLearned}</dd></div></dl><p className="form-help">共 {dashboard.totalCards} 张未删除卡片，已暂停 {dashboard.suspendedCards} 张；今天评分涉及 {dashboard.reviewedCards} 张独立卡片。配额只限制新卡首次学习。</p>
      <div className="learning-language-progress">{(['en', 'de'] as const).map((language) => <div key={language}><h3>{language === 'en' ? '英语' : '德语'}</h3><p>到期 {dashboard.languages[language].due} 张（间隔复习 {dashboard.languages[language].dueReview} / 学习步骤 {dashboard.languages[language].dueLearning}）</p><p>可学新卡 {dashboard.languages[language].availableNew} · 已新学 {dashboard.languages[language].newLearned} · 今日评分 {dashboard.languages[language].events} 次 / {dashboard.languages[language].reviewedCards} 张</p></div>)}</div>
      <h3>最近 7 天</h3><div className="week-statistics"><table><thead><tr><th>当地日期</th><th>评分次数</th><th>独立卡片</th></tr></thead><tbody>{dashboard.week.map((day) => <tr key={day.day}><td>{day.day}</td><td>{day.events}</td><td>{day.cards}</td></tr>)}</tbody></table></div></>}
  </section>
}
