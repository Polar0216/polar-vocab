import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { VocabularyManager } from './VocabularyManager'

export function VocabularyPage() {
  return <>
    <PageHeader eyebrow="每一条，都属于你" title="词汇库" description="保存真实词形，慢慢完善释义、语境和标签。收集与整理都不会自动创建复习卡片。" />
    <div className="library-note"><p>「已整理」不自动生成卡片；选择加入复习后才创建独立词义卡。</p><Link to="/inbox" className="button button-primary">收集新词</Link></div><VocabularyManager />
  </>
}
