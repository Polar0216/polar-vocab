import { useState } from 'react'
import type { VocabularyEntry } from '../../domain'
import { useVocabulary } from '../../app/vocabulary-context'
import { PageHeader } from '../../components/PageHeader'
import { QuickAdd } from '../vocabulary/QuickAdd'
import { VocabularyManager } from '../vocabulary/VocabularyManager'
import { EntryEditor } from '../vocabulary/EntryEditor'
import { ImportPanel } from '../vocabulary/ImportPanel'
import { CaptureInboxPanel } from '../capture/CaptureInboxPanel'

export function InboxPage() {
  const { ready, error } = useVocabulary()
  const [entry, setEntry] = useState<VocabularyEntry | null>(null)
  return <>
    <PageHeader eyebrow="先收下，慢慢整理" title="生词箱" description="只留下单词和语言也很好。你的记录先保存到本机，释义和原句可以慢慢补充。" />
    {ready ? <><QuickAdd onView={setEntry} /><ImportPanel mode="clipboard" /><ImportPanel mode="file" /><CaptureInboxPanel /></> : <p role="status" className="loading-message">{error ? '本机词库未打开，当前无法保存。' : '正在打开本机词库，尚不能保存…'}</p>}
    <VocabularyManager inboxOnly />
    {entry && <EntryEditor entry={entry} onClose={() => setEntry(null)} />}
  </>
}
