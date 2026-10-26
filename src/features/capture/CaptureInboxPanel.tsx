import { SenseDetails } from '../../../packages/shared/SenseDetails'
import { useState } from 'react'
import { useVocabulary } from '../../app/vocabulary-context'
import type { CaptureFile } from '../../integrations/github/captures'
import { buildCapturePreview, type CapturePreviewRow } from './receiver'

export function CaptureInboxPanel() {
  const { service } = useVocabulary()
  const [files, setFiles] = useState<CaptureFile[]>([]), [paths, setPaths] = useState<string[]>([])
  const [rows, setRows] = useState<CapturePreviewRow[]>([]), [chosen, setChosen] = useState<string[]>([])
  const [generation, setGeneration] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const [search, setSearch] = useState(''), [language, setLanguage] = useState('all')
  const engine = async () => (await import('../sync/engine')).syncEngine(service)
  async function scan() {
    setBusy(true); setMessage('正在检查私有仓库中的采集批次…'); setRows([]); setChosen([]); setFiles([])
    try {
      const sync = await engine(), connection = await sync.connection()
      const repository = await sync.captureRepository(), found = await repository.scan()
      if ((await sync.connection())?.generation !== connection?.generation) throw new Error('连接已变化，请重新检查。')
      setFiles(found); setPaths(found.slice(0, 10).map((file) => file.path)); setGeneration(connection!.generation)
      setMessage(found.length ? `已发现 ${found.length} 个批次。请选择最多20个进行预览；尚未导入词条。` : '当前仓库中没有桌面采集批次。')
    } catch (error) { setMessage(error instanceof Error ? error.message : '采集扫描未完成，请检查连接。') }
    finally { setBusy(false) }
  }
  async function preview() {
    setBusy(true); setMessage('正在读取并校验所选批次…'); setRows([]); setChosen([])
    try {
      if (!paths.length || paths.length > 20) throw new Error('每次请选择1–20个批次。')
      const sync = await engine(), repository = await sync.captureRepository()
      if ((await sync.connection())?.generation !== generation) throw new Error('连接已变化，请重新扫描。')
      const batches = []
      for (const file of files.filter((file) => paths.includes(file.path))) batches.push(await repository.download(file))
      const result = buildCapturePreview(batches, await service.snapshot())
      setRows(result); setChosen(result.filter((row) => !row.ingested && !row.duplicateVocabularyIds.length).map((row) => row.event.id))
      setMessage(`已预览 ${result.length} 个事件，其中 ${result.filter((row) => row.ingested).length} 个已接收。相似词默认不勾选，不覆盖已有释义。`)
    } catch (error) { setMessage(error instanceof Error ? error.message : '批次校验失败，未导入任何内容。') }
    finally { setBusy(false) }
  }
  async function ingest() {
    setBusy(true)
    try {
      const sync = await engine()
      if (!sync.authorized() || (await sync.connection())?.generation !== generation) throw new Error('授权或目标已变化，请重新扫描并预览。')
      const events = rows.filter((row) => chosen.includes(row.event.id) && !row.ingested).map((row) => row.event)
      if (!events.length) throw new Error('请先选择尚未接收的事件。')
      const result = await service.ingest(events)
      if (result.status !== 'saved') throw new Error(result.status === 'conflict' ? '捕获ID内容冲突，整次导入已回滚，请保留原文件核查。' : '导入未提交，本机原数据保留。')
      const snapshot = await service.snapshot()
      setRows(rows.map((row) => ({ ...row, ingested: snapshot.ingestedCaptureIds.includes(row.event.id) }))); setChosen([])
      setMessage(`本机已接收 ${result.vocabularyIds.length} 条，跳过 ${result.skippedCaptureIds.length} 个已接收事件。新词均待整理；请使用原有同步将词库保存到GitHub。`)
    } catch (error) { setMessage(error instanceof Error ? error.message : '导入失败，本机数据保留。') }
    finally { setBusy(false) }
  }
  const visible = rows.filter((row) => (language === 'all' || row.event.payload.lang === language) && (!search.trim() || row.event.payload.lemma.toLocaleLowerCase().includes(search.toLocaleLowerCase())))
  return <details className="panel capture-inbox-panel"><summary>接收桌面生词</summary><p className="form-help">从已连接的私有仓库检查桌面收词。预览并确认后进入待整理，不会自动创建复习卡片，也不会清理云端批次。</p><div className="backup-actions"><button className="button button-secondary" disabled={busy} onClick={() => { void scan() }}>检查桌面采集批次</button></div>{message && <p role="status" className="form-help">{message}</p>}
    {!!files.length && <><fieldset><legend>待预览批次（已发现 {files.length} 个）</legend><div className="capture-batch-list">{files.map((file) => <label className="confirmation-check" key={file.path}><input type="checkbox" disabled={busy} checked={paths.includes(file.path)} onChange={(event) => setPaths(event.target.checked ? [...paths, file.path] : paths.filter((path) => path !== file.path))} /><span>{file.path.split('/')[2]} · 设备 {file.path.split('/')[1].slice(0, 8)} · 批次 {file.path.split('/')[3].slice(0, 8)} · {file.size.toLocaleString()} 字节</span></label>)}</div></fieldset><button className="button button-secondary" disabled={busy || !paths.length} onClick={() => { void preview() }}>预览所选桌面批次</button></>}
    {!!rows.length && <><div className="settings-form"><label className="field"><span>搜索采集词形</span><input aria-label="搜索采集词形" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="field"><span>采集语言筛选</span><select aria-label="采集语言筛选" value={language} onChange={(event) => setLanguage(event.target.value)}><option value="all">全部语言</option><option value="en">英语</option><option value="de">德语</option></select></label></div><ul className="capture-preview-list">{visible.map((row) => <li key={row.event.id}><label className="confirmation-check"><input type="checkbox" disabled={busy || row.ingested} checked={chosen.includes(row.event.id)} onChange={(event) => setChosen(event.target.checked ? [...chosen, row.event.id] : chosen.filter((id) => id !== row.event.id))} /><span><strong>{row.event.payload.lemma}</strong> · {row.event.payload.lang.toUpperCase()}{row.ingested ? ' · 已接收' : row.duplicateVocabularyIds.length ? ' · 存在相似词，勾选后独立新增' : ' · 新采集'}</span></label><p>{row.event.payload.meanings?.join('；') || '释义待补充'}</p>{row.event.payload.encounteredForm && <p>原词形：{row.event.payload.encounteredForm}{row.event.payload.lemmaResolution ? ` → ${row.event.payload.lemmaResolution.lemma}` : ""}</p>}{row.event.payload.lexicon && <SenseDetails value={row.event.payload.lexicon} />}{row.event.payload.contexts?.map((context) => <div key={context.id}><p>{context.text}</p>{context.translation && <p lang="zh-CN">{context.translation}<small> · {context.translationSource?.provider}{context.translationSource?.modified ? "（人工修改）" : ""}</small></p>}</div>)}<small>{row.event.payload.source || 'Windows 收集器'}</small></li>)}</ul><p className="form-help">已选 {chosen.length} 个事件（包含筛选后隐藏的已选项）。默认不覆盖已有词条；同一事件重复接收只跳过，不重写你编辑过的释义。</p><button className="button button-primary" disabled={busy || !chosen.length} onClick={() => { void ingest() }}>确认接收到生词箱</button></>}
  </details>
}
