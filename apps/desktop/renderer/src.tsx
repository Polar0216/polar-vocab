import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { DesktopBridge, DesktopSettings, DesktopStatus, QueueItem, QueueState, Reply, SelectionResult } from '../src/contracts'
import type { Language, VocabularyPayload } from '../../../packages/shared'
import './style.css'

declare global { interface Window { polarCapture: DesktopBridge } }
const api = window.polarCapture
const labels: Record<QueueState, string> = { pending: '待上传', uploading: '正在上传', acknowledged: '已确认上传', failed: '上传失败', attention: '需要处理' }
function value<T>(reply: Reply<T>): T { if (!reply.ok) throw new Error(reply.message); return reply.value }
export function App() {
  const [tab, setTab] = useState<'lookup' | 'queue' | 'settings'>('lookup')
  const [status, setStatus] = useState<DesktopStatus>(), [config, setConfig] = useState<DesktopSettings>()
  const [word, setWord] = useState(''), [lang, setLang] = useState<Language>('en'), [meaning, setMeaning] = useState('')
  const [part, setPart] = useState(''), [context, setContext] = useState(''), [source, setSource] = useState('windows:manual'), [tags, setTags] = useState('')
  const [article, setArticle] = useState(''), [plural, setPlural] = useState(''), [past, setPast] = useState(''), [participle, setParticiple] = useState('')
  const [draftId, setDraftId] = useState(crypto.randomUUID()), [saved, setSaved] = useState(false), [saving, setSaving] = useState(false), [dirty, setDirty] = useState(false)
  const [contextId, setContextId] = useState(crypto.randomUUID())
  const [busyLookup, setBusyLookup] = useState(false), [message, setMessage] = useState('选中文字，按 Ctrl + Alt + S；也可以直接输入。')
  const [provenance, setProvenance] = useState(''), [incoming, setIncoming] = useState<SelectionResult>()
  const [search, setSearch] = useState(''), [filter, setFilter] = useState<QueueState | 'all'>('all'), [offset, setOffset] = useState(0), [items, setItems] = useState<QueueItem[]>([]), [total, setTotal] = useState(0)
  const [owner, setOwner] = useState('Polar0216'), [repository, setRepository] = useState('polar-vocab-data-test'), [branch, setBranch] = useState('main'), [token, setToken] = useState(''), [connectionPreview, setConnectionPreview] = useState('')
  const initialized = useRef(false), request = useRef<string | undefined>(undefined), meaningVersion = useRef(0)
  const refresh = useCallback(async () => {
    try {
      const next = value(await api.status()); setStatus(next)
      if (!initialized.current) { initialized.current = true; setConfig(next.settings); setLang(next.settings.language) }
    } catch (error) { setMessage(error instanceof Error ? error.message : '无法读取本机状态。') }
  }, [])
  const perform = useCallback(async (action: () => Promise<Reply<unknown>>) => {
    try { const result = value(await action()); if (typeof result === 'string') setMessage(result); await refresh() }
    catch (error) { setMessage(error instanceof Error ? error.message : '操作未完成。') }
  }, [refresh])
  const cancel = useCallback(() => { if (request.current) { void api.cancelLookup(request.current); request.current = undefined } setBusyLookup(false) }, [])
  const lookup = useCallback(async (text: string, language: Language) => {
    cancel(); if (!text.trim()) { setMessage('请输入单词或短语。'); return }
    const id = crypto.randomUUID(), revision = meaningVersion.current; request.current = id; setBusyLookup(true); setMessage('正在查询 MyMemory…')
    try {
      const translated = value(await api.lookup({ id, text: text.trim(), lang: language }))
      if (request.current !== id) return
      if (meaningVersion.current === revision) { setMeaning(translated.text); setDirty(true); setProvenance(translated.attribution); setMessage('查询完成，请核对或编辑后再收藏。') }
      else setMessage('查询完成；保留你在查询期间手动编辑的释义。')
    } catch (error) { if (request.current === id) setMessage(error instanceof Error ? error.message : '查询失败，可手动填写。') }
    finally { if (request.current === id) { request.current = undefined; setBusyLookup(false) } }
  }, [cancel])
  const acceptSelection = useCallback((selection: SelectionResult) => {
    cancel(); meaningVersion.current++; setDraftId(crypto.randomUUID()); setContextId(crypto.randomUUID()); setSaved(false); setSaving(false); setDirty(false)
    setWord(selection.text); setMeaning(''); setPart(''); setContext(''); setTags(''); setArticle(''); setPlural(''); setPast(''); setParticiple(''); setSource(selection.source); setProvenance(''); setIncoming(undefined); setTab('lookup'); setMessage(selection.reason)
    if (selection.text && config?.autoLookup) void lookup(selection.text, lang)
  }, [cancel, config?.autoLookup, lang, lookup])
  useEffect(() => { queueMicrotask(() => { void refresh() }); const timer = setInterval(() => { void refresh() }, 2000); return () => clearInterval(timer) }, [refresh])
  useEffect(() => api.onSelection((selection) => { if (dirty && !saved) { setIncoming(selection); setMessage('有新的选词，当前未收藏的编辑已保留。') } else acceptSelection(selection) }), [dirty, saved, acceptSelection])
  useEffect(() => { document.documentElement.dataset.theme = config?.theme ?? 'system' }, [config?.theme])
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { cancel(); void api.hide() } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key) }, [cancel])
  const loadQueue = useCallback(async () => { try { const page = value(await api.queue({ search, state: filter, offset })); setItems(page.items); setTotal(page.total) } catch { setMessage('队列读取失败，原记录未清除。') } }, [search, filter, offset])
  useEffect(() => { if (tab === 'queue') queueMicrotask(() => { void loadQueue() }) }, [tab, loadQueue, status?.counts.acknowledged])
  async function save() {
    if (saved || saving) return
    setSaving(true)
    try {
      const common = { lemma: word.trim(), ...(meaning.trim() ? { meanings: [meaning.trim()] } : {}), ...(part.trim() ? { partOfSpeech: part.trim() } : {}), ...(source.trim() ? { source: source.trim() } : {}), ...(context.trim() ? { contexts: [{ id: contextId, text: context.trim() }] } : {}), ...(tags.trim() ? { tags: tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) } : {}) }
      const payload: VocabularyPayload = lang === 'en' ? { ...common, lang } : { ...common, lang, de: { ...(article ? { article: article as 'der' | 'die' | 'das' } : {}), ...(plural.trim() ? { plural: plural.trim() } : {}), ...(past.trim() ? { past: past.trim() } : {}), ...(participle.trim() ? { participleII: participle.trim() } : {}) } }
      value(await api.save({ id: draftId, payload })); setSaved(true); setDirty(false); setMessage('本机已收藏。等待上传，不会自动创建复习卡片。'); await refresh()
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败，编辑内容保留。') }
    finally { setSaving(false) }
  }
  return <main>
    <header><div className="mark">P</div><div><h1>Polar Vocab <span>Capture</span></h1><p>看懂一个词，留下一点积累</p></div><button className="quiet" onClick={() => { cancel(); void api.hide() }} aria-label="关闭窗口">×</button></header>
    <nav aria-label="桌面导航">{(['lookup', 'queue', 'settings'] as const).map((item) => <button key={item} aria-current={tab === item ? 'page' : undefined} onClick={() => setTab(item)}>{{ lookup: '查词与收藏', queue: '本地队列', settings: '设置' }[item]}</button>)}</nav>
    <div className="feedback" role="status">{message}</div>
    {incoming && <aside>新选区：{incoming.text || '未读取到文字'}<div className="actions"><button onClick={() => acceptSelection(incoming)}>切换到新选词</button><button onClick={() => setIncoming(undefined)}>保留当前编辑</button></div></aside>}
    {tab === 'lookup' && <form onSubmit={(event) => { event.preventDefault(); void save() }}>
      <div className="row"><label className="grow">单词或短语<input aria-label="单词或短语" maxLength={500} value={word} disabled={saved} onChange={(event) => { cancel(); setWord(event.target.value); setDirty(true) }} autoFocus /></label><label>语言<select aria-label="查询语言" value={lang} disabled={saved} onChange={(event) => { const next = event.target.value as Language; cancel(); setLang(next); setDirty(true) }}><option value="en">英语</option><option value="de">德语</option></select></label></div>
      <div className="actions"><button type="button" onClick={() => { void lookup(word, lang) }} disabled={busyLookup || !word.trim() || saved}>查询中文释义</button>{busyLookup && <button type="button" onClick={cancel}>取消查询</button>}<button type="button" className="secondary" onClick={() => acceptSelection({ text: '', source: 'windows:manual', method: 'manual', reason: '请输入一个新词；仅收藏时才保存。' })}>新词</button></div>
      <p className="hint">查询会将此处原文发送给 MyMemory，其服务可能保留查询并使用翻译合作方。免费匿名额度约 5,000 字符/日；不会发送其他原句字段、标签或 GitHub 凭证。请勿查询敏感内容。</p>
      <label>中文释义<textarea aria-label="中文释义" maxLength={4000} rows={3} value={meaning} disabled={saved} onChange={(event) => { meaningVersion.current++; setMeaning(event.target.value); setDirty(true) }} /></label>
      {provenance && <p className="hint">{provenance} · 冠词和变形请自行核对，程序不会猜测。</p>}
      <label>词性<input aria-label="词性" maxLength={100} value={part} disabled={saved} onChange={(event) => { setPart(event.target.value); setDirty(true) }} placeholder="例如 noun / verb" /></label>
      {lang === 'de' && <fieldset><legend>德语词形（选填）</legend><div className="row"><label>冠词<select aria-label="德语冠词" value={article} disabled={saved} onChange={(event) => { setArticle(event.target.value); setDirty(true) }}><option value="">未填写</option>{['der', 'die', 'das'].map((item) => <option key={item}>{item}</option>)}</select></label><label className="grow">复数<input aria-label="德语复数" maxLength={500} value={plural} disabled={saved} onChange={(event) => { setPlural(event.target.value); setDirty(true) }} /></label></div><div className="row"><label>过去式<input aria-label="过去式" maxLength={500} value={past} disabled={saved} onChange={(event) => { setPast(event.target.value); setDirty(true) }} /></label><label>第二分词<input aria-label="第二分词" maxLength={500} value={participle} disabled={saved} onChange={(event) => { setParticiple(event.target.value); setDirty(true) }} /></label></div></fieldset>}
      <button type="button" className="secondary" disabled={saved || !word.trim()} onClick={() => { setContext(word.trim()); setDirty(true) }}>将当前原文作为原句</button>
      <label>原句（选填）<textarea aria-label="原句" maxLength={20000} rows={2} value={context} disabled={saved} onChange={(event) => { setContext(event.target.value); setDirty(true) }} placeholder="只选中一个词时，不会自动获取上下文。" /></label>
      <div className="row"><label>标签（逗号分隔）<input aria-label="标签" value={tags} maxLength={8000} disabled={saved} onChange={(event) => { setTags(event.target.value); setDirty(true) }} /></label><label>来源<input aria-label="来源" maxLength={2000} value={source} disabled={saved} onChange={(event) => { setSource(event.target.value); setDirty(true) }} /></label></div>
      <div className="actions footer"><button className="primary" type="submit" disabled={!word.trim() || saved || saving}>{saved ? '已收藏到本机' : saving ? '正在保存…' : '收藏到生词队列'}</button><button className="secondary" type="button" onClick={() => { cancel(); void api.hide() }}>仅查看，关闭</button></div>
    </form>}
    {tab === 'queue' && <section><h2>本地收词队列</h2><p className="hint">收藏先保存在本机。已上传记录仍保留；Web 接收后才进入生词箱。</p><div className="counts">{status && Object.entries(status.counts).map(([key, count]) => <span key={key}>{labels[key as QueueState]} <b>{count}</b></span>)}</div><div className="row"><input aria-label="搜索队列" placeholder="搜索词形或释义" value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0) }} /><select aria-label="队列状态" value={filter} onChange={(event) => { setFilter(event.target.value as QueueState | 'all'); setOffset(0) }}><option value="all">全部状态</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div><div className="actions"><button onClick={() => { void perform(() => api.sync()) }} disabled={!status?.connected || status.syncing}>{status?.syncing ? '上传中…' : '手动同步'}</button><button onClick={() => { void perform(() => api.retry()).then(loadQueue) }}>重试失败队列</button><button onClick={() => { void perform(() => api.exportQueue()) }}>导出队列</button><button onClick={() => { void loadQueue() }}>刷新列表</button></div><p className="hint">共 {total} 条，本页 {items.length} 条</p>{!items.length ? <div className="empty">队列暂时没有匹配的记录。选一个词试试。</div> : <ul className="queue-list">{items.map(({ event, state, errorCode }) => <li key={event.id}><div><strong>{event.payload.lemma}</strong><span className="badge">{event.payload.lang.toUpperCase()} · {labels[state]}</span></div><p>{event.payload.meanings?.join('；') || '释义待补充'}</p><small>{new Date(event.capturedAt).toLocaleString()}{errorCode ? ' · ' + errorCode : ''}</small></li>)}</ul>}<div className="actions"><button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 100))}>上一页</button><button disabled={offset + items.length >= total} onClick={() => setOffset(offset + 100)}>下一页</button></div></section>}
    {tab === 'settings' && config && <section><h2>快捷键与偏好</h2><label>全局快捷键<select aria-label="全局快捷键" value={config.shortcut} onChange={(event) => setConfig({ ...config, shortcut: event.target.value })}>{['Control+Alt+S', 'Control+Alt+D', 'Control+Shift+S', 'Control+Shift+D', 'Alt+Shift+S'].map((key) => <option key={key}>{key}</option>)}</select></label><p className="hint">当前注册：{status?.shortcutRegistered ? '成功' : '失败，请更换组合'}</p><div className="row"><label>默认语言<select aria-label="默认语言" value={config.language} onChange={(event) => setConfig({ ...config, language: event.target.value as Language })}><option value="en">英语</option><option value="de">德语</option></select></label><label>主题<select aria-label="主题" value={config.theme} onChange={(event) => setConfig({ ...config, theme: event.target.value as DesktopSettings['theme'] })}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label></div><label className="check"><input type="checkbox" checked={config.clipboardFallback} onChange={(event) => setConfig({ ...config, clipboardFallback: event.target.checked })} />允许纯文本剪贴板复制回退（其他格式保持不动）</label><label className="check"><input type="checkbox" checked={config.autoLookup} onChange={(event) => setConfig({ ...config, autoLookup: event.target.checked })} />触发划词后自动查询 MyMemory</label><label className="check"><input type="checkbox" checked={config.autoSync} onChange={(event) => setConfig({ ...config, autoSync: event.target.checked })} />授权后自动批量上传（至少一分钟间隔，有限重试）</label><button onClick={() => { void perform(() => api.settings(config)) }}>保存设置</button>
      <h2>GitHub 私有采集仓库</h2><p role="status" className="hint">{status?.connected ? '当前会话已连接' : '未授权，队列保留'}{status?.target ? ' · ' + status.target : ''}</p><p className="hint">仅写入采集批次，不修改卡片或复习记录。使用新的受限测试凭证，不复用聊天中暴露的旧 PAT。凭证仅当前会话内存保存，关闭应用后需重新输入。</p><label>仓库所有者<input aria-label="仓库所有者" value={owner} maxLength={100} onChange={(event) => setOwner(event.target.value)} /></label><label>私有仓库名称<input aria-label="私有仓库名称" value={repository} maxLength={100} onChange={(event) => setRepository(event.target.value)} /></label><label>分支<input aria-label="分支" value={branch} maxLength={200} onChange={(event) => setBranch(event.target.value)} /></label><label>Fine-grained PAT<input aria-label="Fine-grained PAT" type="password" autoComplete="off" spellCheck={false} maxLength={512} value={token} onChange={(event) => setToken(event.target.value)} /></label><div className="actions"><button disabled={!token.trim()} onClick={() => { const input = { owner, repository, branch, token }; setToken(''); void api.connect(input).then((reply) => { try { setConnectionPreview(value(reply)); setMessage('只读测试成功，请核对目标后确认。') } catch (error) { setMessage(error instanceof Error ? error.message : '连接失败。') } }) }}>测试连接（只读）</button><button disabled={!status?.connected} onClick={() => { void perform(() => api.disconnect()) }}>断开连接，保留队列</button></div>
      <h2>本机数据</h2><p className="path">{status?.dataDirectory}</p><p className="hint">队列：captures.sqlite；日志：logs/events.log（只记录固定分类，不记录选词或凭证）。便携程序退出或移除不删除本机数据。未启用开机自启动。</p><div className="actions"><button onClick={() => { void api.openWebsite() }}>打开 Polar Vocab 网站</button><button onClick={() => { cancel(); void api.quit() }}>退出并释放快捷键</button></div>
    </section>}
    {connectionPreview && <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-label="确认桌面采集连接" className="modal"><h2>确认采集目标</h2><p>{connectionPreview}</p><p>确认后仅向此私有目标创建采集批次，原记录与复习状态保持。现在不会清空队列或云端。</p><div className="actions"><button className="primary" onClick={() => { setConnectionPreview(''); void perform(() => api.confirmConnection()) }}>确认连接</button><button onClick={() => { setConnectionPreview(''); void api.cancelConnection() }}>取消</button></div></section></div>}
  </main>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
