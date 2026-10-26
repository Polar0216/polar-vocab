import { SenseDetails } from '../../../packages/shared/SenseDetails'
import { useEffect, useMemo, useState } from 'react'
import type { VocabularyEntry } from '../../domain'
import { useVocabulary, errorMessage } from '../../app/vocabulary-context'
import { EmptyState } from '../../components/EmptyState'
import { Feedback } from '../../components/Feedback'
import { Dialog } from '../../components/Dialog'
import { downloadBlob, datedFilename } from '../../components/download'
import { exportVocabularyCsv } from '../import-export/export-service'
import { EntryEditor } from './EntryEditor'
import { displayLemma, splitTags, statusLabels } from './entry-ui'
import type { LocalVocabularyService } from './service'
import { CreateCardsButton } from '../review/CreateCardsButton'

type Query = NonNullable<Parameters<LocalVocabularyService['list']>[0]>

export function VocabularyManager({ inboxOnly = false }: { inboxOnly?: boolean }) {
  const { service, ready, version, error: initializationError } = useVocabulary()
  const [search, setSearch] = useState('')
  const [language, setLanguage] = useState('')
  const [status, setStatus] = useState('')
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState<Query['sort']>('created-desc')
  const [page, setPage] = useState(1)
  const [entries, setEntries] = useState<VocabularyEntry[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const [editEntry, setEditEntry] = useState<VocabularyEntry | null>(null)
  const [batchTags, setBatchTags] = useState('')
  const [batchStatus, setBatchStatus] = useState<VocabularyEntry['status']>('learning')
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null)
  const query = useMemo<Query>(() => ({ search, language: language ? language as 'en' | 'de' : undefined, status: inboxOnly ? 'inbox' : status ? status as VocabularyEntry['status'] : undefined, tag: tag || undefined, sort }), [search, language, status, tag, sort, inboxOnly])

  useEffect(() => {
    if (!ready) return
    let active = true
    void Promise.all([service.list(query), service.list()]).then(([list, all]) => {
      if (!active) return
      setEntries(list); setAllTags([...new Set(all.flatMap((entry) => entry.tags ?? []))].sort()); setLoading(false)
      setSelected((previous) => previous.filter((id) => list.some((entry) => entry.id === id)))
    }).catch((error: unknown) => { if (active) { setFeedback({ text: errorMessage(error), error: true }); setLoading(false) } })
    return () => { active = false }
  }, [service, ready, version, query])

  async function batch(patch: Parameters<LocalVocabularyService['batchUpdate']>[1]) {
    setBusy(true); setFeedback(null)
    try { await service.batchUpdate(selected, patch); setSelected([]); setBatchTags(''); setFeedback({ text: '批量修改已保存到本机。待同步操作已保留，请在设置查看云端确认状态。' }) }
    catch (error) { setFeedback({ text: errorMessage(error), error: true }) }
    finally { setBusy(false) }
  }

  async function remove() {
    if (!deleteIds) return
    setBusy(true); setFeedback(null)
    try { await service.softDelete(deleteIds); setSelected([]); setDeleteIds(null); setFeedback({ text: '已软删除选中词条，删除标记和历史记录已保留。' }) }
    catch (error) { setFeedback({ text: errorMessage(error), error: true }) }
    finally { setBusy(false) }
  }

  function resetSelection() { setSelected([]); setPage(1) }
  const pageCount = Math.max(1, Math.ceil(entries.length / 50))
  const currentPage = Math.min(page, pageCount)
  const displayedEntries = entries.slice((currentPage - 1) * 50, currentPage * 50)
  async function exportCurrent() {
    try { downloadBlob(await exportVocabularyCsv(await service.list(query)), datedFilename('polar-vocab-filtered', 'csv')); setFeedback({ text: '已请求下载当前筛选结果，请检查浏览器下载。' }) }
    catch (error) { setFeedback({ text: errorMessage(error), error: true }) }
  }

  return <section className="manager-card" aria-label={inboxOnly ? '待整理词条管理' : '完整词库管理'}>
    <div className="manager-heading"><div><h2>{inboxOnly ? '待整理词条' : '全部词条'}</h2><p>{ready && !loading ? `${entries.length} 条筛选结果` : initializationError ? '词库未打开，暂时无法读取' : '正在读取本机词库…'}</p></div><button className="button button-secondary" disabled={!ready || busy} onClick={() => void exportCurrent()}>导出当前结果 CSV</button></div>
    <div className="manager-filters"><label className="field search-field"><span className="sr-only">搜索词条</span><input aria-label="搜索词条" value={search} onChange={(event) => { setSearch(event.target.value); resetSelection() }} placeholder="搜索单词、释义或原句" /></label><label className="field"><span className="sr-only">筛选语言</span><select aria-label="筛选语言" value={language} onChange={(event) => { setLanguage(event.target.value); resetSelection() }}><option value="">全部语言</option><option value="en">英语</option><option value="de">德语</option></select></label>{!inboxOnly && <label className="field"><span className="sr-only">筛选状态</span><select aria-label="筛选状态" value={status} onChange={(event) => { setStatus(event.target.value); resetSelection() }}><option value="">全部状态</option>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}<label className="field"><span className="sr-only">筛选标签</span><select aria-label="筛选标签" value={tag} onChange={(event) => { setTag(event.target.value); resetSelection() }}><option value="">全部标签</option>{allTags.map((value) => <option value={value} key={value}>{value}</option>)}</select></label><label className="field"><span className="sr-only">排序</span><select aria-label="排序" value={sort} onChange={(event) => { setSort(event.target.value as Query['sort']); resetSelection() }}><option value="created-desc">最近添加</option><option value="created-asc">最早添加</option><option value="lemma-asc">词形 A → Z</option><option value="lemma-desc">词形 Z → A</option><option value="updated-desc">最近修改</option></select></label></div>
    {feedback && <Feedback message={feedback.text} error={feedback.error} />}
    {selected.length > 0 && <CreateCardsButton ids={selected} label="选中词条加入复习" disabled={busy} />}
    {ready && !loading && entries.length > 0 && <><div className="selection-bar"><label className="selection-label"><input type="checkbox" checked={selected.length === entries.length} onChange={(event) => setSelected(event.target.checked ? entries.map((entry) => entry.id) : [])} />全选当前筛选结果（全部 {entries.length} 条）</label><span>已选 {selected.length} 条</span></div>
      {selected.length > 0 && <div className="batch-toolbar"><label className="field"><span className="sr-only">批量标签</span><input aria-label="批量标签" value={batchTags} onChange={(event) => setBatchTags(event.target.value)} placeholder="添加标签（逗号分隔）" /></label><button className="button button-secondary" disabled={busy || !splitTags(batchTags).length} onClick={() => void batch({ addTags: splitTags(batchTags) })}>添加标签</button><label className="field"><span className="sr-only">批量状态</span><select aria-label="批量状态" value={batchStatus} onChange={(event) => setBatchStatus(event.target.value as VocabularyEntry['status'])}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><button className="button button-secondary" disabled={busy} onClick={() => void batch({ status: batchStatus })}>应用状态</button><button className="button button-secondary" disabled={busy} onClick={() => void batch({ status: 'archived' })}>归档选中</button><button className="button button-danger" disabled={busy} onClick={() => setDeleteIds(selected)}>删除选中</button></div>}
      <ul className="vocabulary-list">{displayedEntries.map((entry) => <li className="vocabulary-row" key={entry.id}><label className="row-select"><input type="checkbox" aria-label={`选择 ${entry.lemma}`} checked={selected.includes(entry.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, entry.id] : selected.filter((id) => id !== entry.id))} /></label><div className="entry-main"><div className="entry-title"><span className={`entry-language ${entry.lang}`}>{entry.lang.toUpperCase()}</span><button className="entry-word" onClick={() => setEditEntry(entry)}>{displayLemma(entry)}</button></div><p className="entry-meaning">{entry.meanings?.length ? entry.meanings.join('；') : '释义留待补充'}</p>{entry.encounteredForm && <p className="entry-context">原词形：{entry.encounteredForm}</p>}{entry.lexicon && <SenseDetails value={entry.lexicon} />}{entry.contexts?.[0] && <p className="entry-context">{entry.contexts[0].text}</p>}<div className="entry-tags">{entry.tags?.map((value) => <span key={value}>{value}</span>)}</div></div><div className="entry-meta"><span className={`entry-status status-${entry.status}`}>{statusLabels[entry.status]}</span><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleDateString('zh-CN')}</time></div><div className="entry-actions"><CreateCardsButton ids={[entry.id]} label={`加入复习 ${entry.lemma}`} disabled={busy} /><button className="button button-quiet" aria-label={`编辑 ${entry.lemma}`} onClick={() => setEditEntry(entry)}>编辑</button><button className="button button-quiet danger-text" aria-label={`删除 ${entry.lemma}`} disabled={busy} onClick={() => setDeleteIds([entry.id])}>删除</button></div></li>)}</ul>
      <nav className="pagination" aria-label="词库分页"><span>第 {currentPage} / {pageCount} 页 · 每页最多 50 条</span><div><button className="button button-secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</button><button className="button button-secondary" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>下一页</button></div></nav>
    </>}
    {ready && !loading && entries.length === 0 && <EmptyState icon={inboxOnly ? 'inbox' : 'library'} title={search || language || tag || status ? '暂时没有匹配的词条' : inboxOnly ? '生词箱里，留着新的可能' : '词汇库还没有词条'} description={search || language || tag || status ? '试着换一个关键词，或放宽筛选条件。' : '从单词和语言开始，释义和语境以后再补充。你的保存只在本机，记得定期备份。'} />}
    {(!ready || loading) && <p role="status" className="loading-message">{initializationError ? '请先重新打开词库，数据读取失败不会清空记录。' : '正在读取本机词库…'}</p>}
    {editEntry && <EntryEditor entry={editEntry} onClose={() => setEditEntry(null)} onSaved={() => setFeedback({ text: '修改已保存到本机。待同步操作已保留，请在设置查看云端确认状态。' })} />}
    {deleteIds && <Dialog title="确认删除词条" onClose={() => { if (!busy) setDeleteIds(null) }}><p className="form-help">将软删除 {deleteIds.length} 条词条。它们会从词库中隐藏，删除标记与已有历史保留；不会将它们重新加入学习。此处没有撤销按钮，请先确认。</p><div className="dialog-actions"><button className="button button-secondary" disabled={busy} onClick={() => setDeleteIds(null)}>取消</button><button className="button button-danger" disabled={busy} onClick={() => void remove()}>{busy ? '正在删除…' : '确认删除'}</button></div></Dialog>}
  </section>
}
