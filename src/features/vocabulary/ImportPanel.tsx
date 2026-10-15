import { useMemo, useState } from 'react'
import { useVocabulary, errorMessage } from '../../app/vocabulary-context'
import type { Language } from '../../domain'
import { LocalFileImportService } from '../import-export/import-service'
import type { DuplicateChoice, ImportField, ImportPreview } from '../import-export/contracts'
import { Feedback } from '../../components/Feedback'
import { ImportPreviewView } from './ImportPreviewView'

const fieldLabels: { field: ImportField; label: string }[] = [
  { field: 'word', label: '词形（必填）' }, { field: 'lang', label: '语言' }, { field: 'meaning', label: '释义' },
  { field: 'context', label: '原句' }, { field: 'source', label: '来源' }, { field: 'tags', label: '标签' }, { field: 'created_at', label: '创建时间' },
]

export function ImportPanel({ mode }: { mode: 'clipboard' | 'file' }) {
  const { service, clipboard, ready, defaultLanguage } = useVocabulary()
  const importer = useMemo(() => new LocalFileImportService(service), [service])
  const [language, setLanguage] = useState<Language>(defaultLanguage)
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState('')
  const [incoming, setIncoming] = useState<string | null>(null)
  const [mapping, setMapping] = useState<Partial<Record<ImportField, string>>>({})
  const [sheetName, setSheetName] = useState<string | undefined>()
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [choices, setChoices] = useState<Record<string, DuplicateChoice>>({})
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [manualPaste, setManualPaste] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null)

  async function makePreview(selectedFile = file, selectedText = text, selectedMapping = mapping, selectedSheet = sheetName) {
    setBusy(true); setFeedback(null)
    try {
      const result = mode === 'clipboard' ? await importer.previewClipboard(selectedText, language) : selectedFile ? await importer.preview(selectedFile, { defaultLanguage: language, mapping: selectedMapping, sheetName: selectedSheet }) : null
      if (!result) return
      setPreview(result); setMapping(result.mapping); setChoices({}); setSheetName(result.sheetName); setDirty(false)
      if (!result.totalRows) setFeedback({ text: '没有可导入的内容。请保留单词或短语，再生成预览。', error: true })
    } catch (error) { setFeedback({ text: errorMessage(error), error: true }); setDirty(true) }
    finally { setBusy(false) }
  }

  async function readClipboard() {
    // Called immediately from this explicit user gesture, before other awaited work.
    const request = clipboard.readText()
    setBusy(true); setFeedback(null)
    try {
      const result = await request
      if (result.status === 'success') {
        if (text.trim()) { setIncoming(result.text.trim()); setFeedback({ text: '已读取剪贴板。当前输入保留，你可以选择采用新内容。' }) }
        else { setText(result.text.trim()); setPreview(null); setDirty(true); setManualPaste(false); setFeedback({ text: '已读取，请确认或编辑文本，再生成预览。尚未保存。' }) }
      } else { setManualPaste(true); setFeedback({ text: result.status === 'empty' ? '剪贴板为空，请在下方输入或手动粘贴。' : '此浏览器未允许直接读取。请在下方长按或使用 Ctrl+V 手动粘贴；已有输入已保留。' }) }
    } catch { setManualPaste(true); setFeedback({ text: '读取剪贴板失败，请在下方手动粘贴；已有输入已保留。', error: true }) }
    finally { setBusy(false) }
  }

  async function commit() {
    if (!preview || dirty) return
    setBusy(true); setFeedback(null)
    try {
      const result = await importer.commit(preview, choices)
      setFeedback({ text: `本地导入完成：新增 ${result.added} 条、补充 ${result.updated} 条、跳过 ${result.skipped} 条。待同步操作已保留，请在设置查看云端确认状态。` })
      setPreview(null); setFile(null); setText(''); setChoices({}); setIncoming(null); setDirty(false)
    } catch (error) { setFeedback({ text: `${errorMessage(error)} 预览已保留，未确认成功前请勿重复生成。`, error: true }) }
    finally { setBusy(false) }
  }

  const body = <>
    {mode === 'clipboard' ? <><div className="clipboard-heading"><div><h2>从剪贴板收词</h2><p>单词、短语、多行列表或 Tab 表格，都先预览再确认。</p></div><button className="button button-secondary" disabled={!ready || busy} onClick={() => void readClipboard()}>从剪贴板导入</button></div><label className="field clipboard-text"><span>{manualPaste ? '手动粘贴文本' : '待导入文本（可编辑）'}</span><textarea aria-label="剪贴板或手动粘贴文本" value={text} onChange={(event) => { setText(event.target.value); setDirty(true) }} rows={3} placeholder="在这里粘贴；多行文本会进入批量预览。" maxLength={2_000_000} /></label>{incoming !== null && <div className="duplicate-notice"><p className="clipboard-incoming">{incoming}</p><button className="button button-secondary" onClick={() => { setText(incoming); setIncoming(null); setPreview(null); setDirty(true) }}>采用剪贴板内容</button><button className="button button-quiet" onClick={() => setIncoming(null)}>保留当前输入</button></div>}</> : <><p className="form-help">CSV（含 Numbers 导出）、TXT、XLSX 均在本机解析。最多 10 MiB、5,000 行；JSON 完整备份请到设置中恢复。</p><label className="field file-picker"><span>选择词汇文件</span><input type="file" aria-label="选择词汇文件" accept=".csv,.txt,.xlsx,.numbers" disabled={!ready || busy} onChange={(event) => { const selectedFile = event.target.files?.[0]; if (!selectedFile) return; setFile(selectedFile); setMapping({}); setPreview(null); setSheetName(undefined); setDirty(true); void makePreview(selectedFile, '', {}, undefined) }} /></label>{file && <p className="form-help">当前文件：{file.name}</p>}</>}
    <div className="import-options"><label className="field"><span>缺少语言时默认使用</span><select value={language} aria-label={mode === 'clipboard' ? '剪贴板默认语言' : '文件默认语言'} onChange={(event) => { setLanguage(event.target.value as Language); setDirty(true) }}><option value="en">英语 · EN</option><option value="de">德语 · DE</option></select></label>{mode === 'file' && preview?.sheetNames && <label className="field"><span>工作表</span><select aria-label="选择工作表" value={sheetName} onChange={(event) => { setSheetName(event.target.value); setMapping({}); setDirty(true) }}>{preview.sheetNames.map((sheet) => <option key={sheet}>{sheet}</option>)}</select></label>}<button className="button button-secondary" disabled={!ready || busy || (mode === 'clipboard' ? !text.trim() : !file)} onClick={() => void makePreview()}>{busy ? '正在处理…' : preview ? '更新预览' : '生成预览'}</button></div>
    {mode === 'file' && preview && <details className="optional-fields" open><summary>字段映射</summary><div className="mapping-grid">{fieldLabels.map(({ field, label }) => <label className="field" key={field}><span>{label}</span><select aria-label={`映射${label}`} value={mapping[field] ?? ''} onChange={(event) => { setMapping({ ...mapping, [field]: event.target.value }); setDirty(true) }}><option value="">{field === 'word' ? '请选择词形列' : '不导入此字段'}</option>{preview.columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>)}</div></details>}
    {preview && <><ImportPreviewView preview={preview} choices={choices} onChoice={(id, value) => setChoices({ ...choices, [id]: value })} />{dirty && <p role="status" className="form-help">内容或映射已改变，请先更新预览。</p>}<div className="inline-actions"><button className="button button-primary" disabled={busy || dirty || !preview.validRows || !ready} onClick={() => void commit()}>{busy ? '正在导入…' : '确认导入有效行'}</button><button className="button button-quiet" disabled={busy} onClick={() => { setPreview(null); setChoices({}); setFeedback({ text: '已取消预览，词库没有因此发生修改。' }) }}>取消导入</button></div></>}
    {feedback && <Feedback message={feedback.text} error={feedback.error} />}
  </>
  return mode === 'clipboard' ? <section className="capture-card clipboard-panel" aria-label="剪贴板导入">{body}</section> : <details className="capture-card file-import-panel"><summary>导入词汇文件 · CSV / TXT / XLSX</summary><div className="file-import-body">{body}</div></details>
}
