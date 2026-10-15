import { Link } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { PageHeader } from '../../components/PageHeader'
import { useVocabulary } from '../../app/vocabulary-context'
import { LearningOverview } from '../review/LearningOverview'

export function HomePage() {
  const { stats, ready, loading } = useVocabulary()
  return <>
    <PageHeader eyebrow="一点一滴，积累语言" title="让每次遇见，都留下来。" description="把零散的英语和德语生词，慢慢整理成自己的语言记忆。" />

    <section className="welcome-card" aria-label="项目进度">
      <div className="welcome-copy"><span className="phase-pill">本地优先 · Phase 2</span><h2>遇到一个新词，就先留下来。</h2><p>先收集，再整理；想记住的词，才加入复习。<br className="desktop-break" />你的词库保存在此浏览器，断网也能积累。请定期导出备份。</p><Link to="/inbox" className="button button-primary">收集新词<Icon name="arrow" /></Link></div>
      <div className="welcome-art" aria-hidden="true"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><span className="art-label art-en">hello</span><span className="art-label art-de">hallo</span><div className="art-core"><Icon name="leaf" /></div><span className="art-caption">每一个词，都是新的连接。</span></div>
    </section>

    <div className="section-heading"><div><h2>两种语言，一点积累</h2><p>分别收集，按自己的节奏学习。</p></div><span className="muted-label">{ready ? '来自本机词库' : loading ? '正在读取…' : '词库未加载'}</span></div>
    <section className="language-grid" aria-label="学习语言">
      {[
        { code: 'EN', name: '英语', native: 'English', detail: '阅读、交流、生活里的每个新发现。', tone: 'english' },
        { code: 'DE', name: '德语', native: 'Deutsch', detail: '连同冠词、词形和语境，一起记住。', tone: 'german' },
      ].map((language) => <article className={`language-card ${language.tone}`} key={language.code}>
        <div className="language-card-top"><span className="language-code">{language.code}</span><div><h3>{language.name}<span>{language.native}</span></h3><p>{language.detail}</p></div></div>
        <div className="language-stats local-language-stats"><div><strong aria-label={`${language.name}词条总数`}>{ready && stats ? language.code === 'EN' ? stats.en : stats.de : '—'}</strong><span>已收集词条</span></div><div className="language-local-note"><span>先收藏，再整理。<br />已整理的词条可明确加入 FSRS 复习。</span></div></div>
        <p className="language-status"><span className="status-dot" />{ready ? '已连接本机 IndexedDB' : '尚未读取词库'}</p>
      </article>)}
    </section>

    <LearningOverview />
    <section className="home-inbox-strip"><div><strong>{ready && stats ? stats.inbox : '—'}</strong><span>条词条待整理</span></div><Link to="/inbox" className="button button-secondary">打开生词箱<Icon name="arrow" /></Link></section>
    <section className="recent-card"><div className="manager-heading"><h2>最近收集</h2><Link to="/vocabulary" className="button button-quiet">查看词汇库<Icon name="arrow" /></Link></div>{ready && stats ? stats.recent.length ? <ul className="recent-list">{stats.recent.map((entry) => <li key={entry.id}><span className={`entry-language ${entry.lang}`}>{entry.lang.toUpperCase()}</span><strong>{entry.lang === 'de' && entry.de?.article ? `${entry.de.article} ` : ''}{entry.lemma}</strong><span>{entry.meanings?.join('；') ?? '释义留待补充'}</span></li>)}</ul> : <p className="form-help">还没有收集词条。从一个词形开始就很好。</p> : <p role="status" className="form-help">{loading ? '正在读取最近添加的词条…' : '词库尚未加载，不显示学习统计。'}</p>}</section>

    <section className="journey-card" aria-label="学习流程"><div className="journey-intro"><Icon name="spark" /><div><h2>留一点空间，给下一步</h2><p>从遇到一个词，到真正记住它。</p></div></div><ol className="journey-steps"><li><span>01</span><strong>收集</strong><p>先留下词形和语言</p></li><li><span>02</span><strong>整理</strong><p>补充释义与真实语境</p></li><li><span>03</span><strong>复习</strong><p>翻卡、自评、按时再见</p></li></ol></section>
  </>
}
