import { useState } from 'react'
import { useVocabulary, errorMessage } from '../../app/vocabulary-context'
import { Dialog } from '../../components/Dialog'
import { Feedback } from '../../components/Feedback'
import { loadReviewService } from './client'
import type { CreateCardsPreview } from './service'

export function CreateCardsButton({ ids, label = '加入复习', disabled = false }: { ids: readonly string[]; label?: string; disabled?: boolean }) {
  const { service, ready } = useVocabulary()
  const [preview, setPreview] = useState<CreateCardsPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  async function inspect() {
    setBusy(true); setMessage(null)
    try { setPreview(await (await loadReviewService(service)).previewCreate(ids)) }
    catch (error) { setMessage({ text: errorMessage(error), error: true }) }
    finally { setBusy(false) }
  }
  async function confirm() {
    if (!preview || busy) return
    setBusy(true)
    try { const cards = await (await loadReviewService(service)).create(preview); setPreview(null); setMessage({ text: '已创建 ' + cards.length + ' 张词义卡片，保存到本机。' }) }
    catch (error) { setMessage({ text: errorMessage(error), error: true }) }
    finally { setBusy(false) }
  }
  return <div className="create-cards-action"><button type="button" className="button button-secondary" disabled={disabled || !ready || busy || !ids.length} onClick={() => void inspect()}>{label}</button>
    {message && <Feedback message={message.text} error={message.error} />}
    {preview && <Dialog title="确认加入复习" onClose={() => { if (!busy) setPreview(null) }}><p>准备创建 <strong>{preview.count}</strong> 张词义卡片。</p><p className="form-help">仅已整理且有释义的词条可加入。{preview.skipped} 条未符合条件或已有卡片（含暂停卡片），将跳过。不会修改词条或重置已有历史。</p>{message?.error && <Feedback message={message.text} error />}<div className="dialog-actions"><button className="button button-secondary" disabled={busy} onClick={() => setPreview(null)}>取消</button><button className="button button-primary" disabled={busy || !preview.count} onClick={() => void confirm()}>确认创建卡片</button></div></Dialog>}
  </div>
}
