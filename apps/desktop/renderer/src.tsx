import { SenseDetails } from '../../../packages/shared/SenseDetails'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { DesktopBridge, DesktopSettings, DesktopStatus, QueueItem, QueueState, Reply, SelectionResult } from '../src/contracts'
import { cleanLexicon, editedSource, emptyLexicon, manualSense, mergeLexicon, senseMeanings, type GermanFields, type Language, type Lexicon, type VocabularyPayload } from '../../../packages/shared'
import { SenseEditor } from '../../../packages/shared/SenseEditor'
import type { DictionaryResult } from '../src/dictionary'
import './style.css'
import './dictionary.css'
import './integrated.css'
import { SentencePane } from './SentencePane'
import { GermanFieldsEditor } from './GermanFieldsEditor'
import { ConnectionSettings } from './ConnectionSettings'
import { classifyText, type QueryMode, type TextToken } from '../src/text-analysis'
import type { SentenceTranslation } from '../src/sentence'
import type { LemmaCandidate, FieldSource } from '../../../packages/shared'

declare global { interface Window { polarCapture: DesktopBridge } }
const api = window.polarCapture
const labels: Record<QueueState, string> = { pending: '待上传', uploading: '正在上传', acknowledged: '已确认上传', failed: '上传失败', attention: '需要处理' }
function value<T>(reply: Reply<T>): T { if (!reply.ok) throw new Error(reply.message); return reply.value }
export function App() {
  const [tab, setTab] = useState<'lookup' | 'queue' | 'settings'>('lookup')
  const [status, setStatus] = useState<DesktopStatus>(), [config, setConfig] = useState<DesktopSettings>()
  const [sourceText, setSourceText] = useState(''), [mode, setMode] = useState<QueryMode | 'auto'>('auto'), [selectedStart, setSelectedStart] = useState<number | null>(null)
  const [sentenceChinese, setSentenceChinese] = useState(''), [sentenceResult, setSentenceResult] = useState<SentenceTranslation>(), [busySentence, setBusySentence] = useState(false), [keepTranslation, setKeepTranslation] = useState(false)
  const [sentenceSource, setSentenceSource] = useState<FieldSource>({ provider: 'manual' }), [candidates, setCandidates] = useState<LemmaCandidate[]>([]), [resolution, setResolution] = useState<LemmaCandidate>()
  const surface = useRef(''), wordGeneration = useRef(0), sentenceRequest = useRef<string | undefined>(undefined), sentenceRevision = useRef(0), sentenceQueryRevision = useRef(0), dictionaryEdits = useRef(0), requestMeta = useRef<{ phrase: boolean; sentenceRevision: number }>({ phrase: false, sentenceRevision: 0 })
  const [word, setWord] = useState(''), [lang, setLang] = useState<Language>('en')
  const [lexicon, setLexicon] = useState<Lexicon>(() => ({ ...emptyLexicon(), senses: [manualSense()] })), [german, setGerman] = useState<GermanFields>({})
  const [context, setContext] = useState(''), [source, setSource] = useState('windows:manual'), [tags, setTags] = useState('')
  const [draftId, setDraftId] = useState(crypto.randomUUID()), [saved, setSaved] = useState(false), [saving, setSaving] = useState(false), [dirty, setDirty] = useState(false)
  const [contextId, setContextId] = useState(crypto.randomUUID()), sentenceContextId = useRef(crypto.randomUUID())
  const [busyLookup, setBusyLookup] = useState(false), [message, setMessage] = useState('选中文字，按 Ctrl + Alt + S；也可以直接输入。')
  const [selectionPending, setSelectionPending] = useState(false), [paintRequest, setPaintRequest] = useState('')
  const translating = useRef(new Map<string, string>()), [translatingIds, setTranslatingIds] = useState<string[]>([])
  const activeCapture = useRef('')
  const [incoming, setIncoming] = useState<SelectionResult>()
  const [search, setSearch] = useState(''), [filter, setFilter] = useState<QueueState | 'all'>('all'), [offset, setOffset] = useState(0), [items, setItems] = useState<QueueItem[]>([]), [total, setTotal] = useState(0)
  const [connectionPreview, setConnectionPreview] = useState(''), [rememberDevice, setRememberDevice] = useState(false)
  const actualMode = mode === 'auto' ? classifyText(sourceText, lang) : mode
  const initialized = useRef(false), request = useRef<string | undefined>(undefined), editedForms = useRef(new Set<string>())
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
  const cancel = useCallback(() => { if (request.current) { void api.cancelLookup(request.current); request.current = undefined } for (const id of translating.current.values()) void api.cancelLookup(id); translating.current.clear(); setTranslatingIds([]); setBusyLookup(false) }, [])
  const cancelSentence = useCallback(() => { if (sentenceRequest.current) void api.cancelLookup(sentenceRequest.current); sentenceRequest.current = undefined; setBusySentence(false) }, [])
  const cancelAll = useCallback(() => { cancel(); cancelSentence() }, [cancel, cancelSentence])
  const applySentence = useCallback((result: SentenceTranslation) => { setSentenceResult(result); setSentenceChinese(result.text); setSentenceSource({ provider: 'mymemory', url: 'https://mymemory.translated.net/' }) }, [])
  useEffect(() => api.onSentence(progress => { if (sentenceRequest.current === progress.id && sentenceRevision.current === sentenceQueryRevision.current) applySentence(progress.result) }), [applySentence])
  const translateSentence = useCallback(async (text: string, language: Language) => {
    cancelSentence(); if (!text.trim()) return
    const id = crypto.randomUUID(), revision = sentenceRevision.current; sentenceRequest.current = id; sentenceQueryRevision.current = revision; setBusySentence(true)
    try { const result = value(await api.translateSentence({ id, text, lang: language, ...(activeCapture.current ? { captureId: activeCapture.current } : {}) })); if (sentenceRequest.current === id && sentenceRevision.current === revision) applySentence(result) }
    catch (error) { if (sentenceRequest.current === id) setMessage(error instanceof Error ? error.message : '整句翻译失败，原文保留。') }
    finally { if (sentenceRequest.current === id) { sentenceRequest.current = undefined; setBusySentence(false) } }
  }, [cancelSentence, applySentence])
  const applyDictionary = useCallback((result: DictionaryResult) => {
    setLexicon(previous => mergeLexicon(previous, result.lexicon))
    setGerman(previous => ({ ...previous, ...Object.fromEntries(Object.entries(result.de ?? {}).filter(([key]) => !editedForms.current.has(key))) }))
    if (result.lemmaCandidates?.length) setCandidates(result.lemmaCandidates)
    if (requestMeta.current.phrase && sentenceRevision.current === requestMeta.current.sentenceRevision) { const chinese = result.lexicon.senses.flatMap(sense => sense.chinese ? [sense.chinese] : []).join('；'); if (chinese) { setSentenceChinese(chinese); setSentenceResult(undefined); setSentenceSource({ provider: 'mymemory', url: 'https://mymemory.translated.net/' }) } }
    setDirty(true)
  }, [])
  useEffect(() => api.onLookup(progress => { if (request.current === progress.id) { applyDictionary(progress.result); setMessage('词典义项已显示，正在异步补充中文；可立即编辑。') } }), [applyDictionary])
  const lookup = useCallback(async function query(text: string, language: Language, resolveLemma = true) {
    cancel(); if (!text.trim()) { setMessage('请输入单词或短语。'); return }
    const id = crypto.randomUUID(), editRevision = dictionaryEdits.current; request.current = id; requestMeta.current = { phrase: !classifyText(text, language).includes('word') && surface.current === text, sentenceRevision: sentenceRevision.current }; setBusyLookup(true); setMessage('正在查询英德词典…')
    try {
      const result = value(await api.lookup({ id, text: text.trim(), lang: language, ...(activeCapture.current ? { captureId: activeCapture.current } : {}) }))
      if (request.current !== id) return
      applyDictionary(result); setMessage(['查询完成，请核对或编辑后再收藏。', ...result.warnings].join(' '))
      const unique = [...new Map((result.lemmaCandidates ?? []).map(candidate => [candidate.lemma, candidate])).values()]
      if (resolveLemma && editRevision === 0 && editRevision === dictionaryEdits.current && !result.hasIndependentSenses && unique.length === 1 && unique[0].lemma !== text.trim()) {
        const candidate = unique[0]; setWord(candidate.lemma); setResolution(candidate); setLexicon({ ...emptyLexicon(), senses: [manualSense()] }); setGerman({}); editedForms.current.clear(); await query(candidate.lemma, language, false)
      }
    } catch (error) { if (request.current === id) setMessage(error instanceof Error ? error.message : '查询失败，可手动填写。') }
    finally { if (request.current === id) { request.current = undefined; setBusyLookup(false) } }
  }, [cancel, applyDictionary])
  function resetDictionary() { setLexicon({ ...emptyLexicon(), senses: [manualSense()] }); setGerman({}); editedForms.current.clear() }
  function changeLanguage(next: Language) {
    cancelAll(); wordGeneration.current++; sentenceRevision.current++; dictionaryEdits.current = 0
    resetDictionary(); setLang(next); setResolution(undefined); setCandidates([])
    setDraftId(crypto.randomUUID()); setSaved(false); setSaving(false); setDirty(true)
    setSentenceChinese(''); setSentenceResult(undefined); setSentenceSource({ provider: 'manual' }); setKeepTranslation(false)
    setMessage('语言已切换，请重新查询或填写义项；原文和上下文保留。')
  }
  function changeGerman<K extends keyof GermanFields>(field: K, next: GermanFields[K]) {
    dictionaryEdits.current++; editedForms.current.add(field); setGerman(previous => ({ ...previous, [field]: next }))
    setLexicon(previous => ({ ...previous, fieldSources: { ...previous.fieldSources, ['de.' + field]: editedSource(previous.fieldSources['de.' + field]) } })); setDirty(true)
  }
  async function translateSense(senseId: string) {
    const sense = lexicon.senses.find(item => item.id === senseId)
    if (!sense?.definition || translating.current.has(senseId) || translating.current.size >= 2) return
    const id = crypto.randomUUID(); translating.current.set(senseId, id); setTranslatingIds([...translating.current.keys()])
    try {
      const result = value(await api.translate({ id, text: sense.definition, lang: sense.definitionLanguage ?? 'en' }))
      if (translating.current.get(senseId) !== id) return
      setLexicon(previous => ({ ...previous, senses: previous.senses.map(item => item.id === senseId && item.definition === sense.definition && !item.sources.chinese?.modified && item.sources.chinese?.provider !== 'manual' ? { ...item, chinese: result.text, sources: { ...item.sources, chinese: { provider: 'mymemory', url: 'https://mymemory.translated.net/' } } } : item) }))
      setDirty(true); setMessage('此义项中文候选已补充，请核对。')
    } catch (error) { if (translating.current.get(senseId) === id) setMessage(error instanceof Error ? error.message : '翻译失败，原义项保留。') }
    finally { if (translating.current.get(senseId) === id) { translating.current.delete(senseId); setTranslatingIds([...translating.current.keys()]) } }
  }
  const acceptSelection = useCallback((selection: SelectionResult, automatic = true) => {
    cancelAll(); wordGeneration.current++; sentenceRevision.current++; dictionaryEdits.current = 0; editedForms.current.clear()
    const nextMode = classifyText(selection.text, lang); surface.current = nextMode === 'sentence' ? '' : selection.text.trim(); sentenceContextId.current = crypto.randomUUID()
    setDraftId(crypto.randomUUID()); setContextId(sentenceContextId.current); setSaved(false); setSaving(false); setDirty(false)
    setSourceText(selection.text); setMode('auto'); setSelectedStart(null); setSentenceChinese(''); setSentenceResult(undefined); setKeepTranslation(false); setSentenceSource({ provider: 'manual' }); setCandidates([]); setResolution(undefined)
    setWord(nextMode === 'sentence' ? '' : selection.text.trim()); setLexicon({ ...emptyLexicon(), senses: [manualSense()] }); setGerman({}); setContext(nextMode === 'word' ? '' : selection.text); setTags(''); setSource(selection.source); setIncoming(undefined); setTab('lookup'); setMessage(selection.reason)
    if (automatic && selection.text && config?.autoLookup && config.onlineLookup) {
      if (nextMode === 'sentence') { if (new TextEncoder().encode(selection.text).length <= 500) void translateSentence(selection.text, lang) }
      else void lookup(selection.text, lang)
    }
  }, [cancelAll, config?.autoLookup, config?.onlineLookup, lang, lookup, translateSentence])
  function chooseSurface(token: TextToken) {
    cancel(); wordGeneration.current++; dictionaryEdits.current = 0; editedForms.current.clear(); surface.current = token.text
    setWord(token.text); setSelectedStart(token.start); setDraftId(crypto.randomUUID()); setSaved(false); setSaving(false); setDirty(true); setLexicon({ ...emptyLexicon(), senses: [manualSense()] }); setGerman({}); setCandidates([]); setResolution(undefined); setContext(sourceText); setContextId(sentenceContextId.current)
    if (config?.onlineLookup) void lookup(token.text, lang)
  }
  function chooseLemma(candidate?: LemmaCandidate) {
    cancel(); wordGeneration.current++; dictionaryEdits.current = 0; editedForms.current.clear(); setSaved(false); setDirty(true); setDraftId(crypto.randomUUID()); setResolution(candidate); setWord(candidate?.lemma ?? surface.current); setLexicon({ ...emptyLexicon(), senses: [manualSense()] }); setGerman({})
    if (config?.onlineLookup) void lookup(candidate?.lemma ?? surface.current, lang, false)
  }
  useEffect(() => { queueMicrotask(() => { void refresh() }); const timer = setInterval(() => { void refresh() }, 2000); return () => clearInterval(timer) }, [refresh])
  useEffect(() => api.onCaptureProgress((progress) => {
    activeCapture.current = progress.id; setSelectionPending(progress.phase === 'reading'); cancelAll()
    if (progress.phase === 'reading') setMessage(progress.repeated ? '正在读取最新选区，当前编辑保留…' : '正在读取选区，当前编辑保留…')
  }), [cancelAll])
  useEffect(() => api.onSelection((selection) => {
    if (selection.requestId && selection.requestId !== activeCapture.current) return
    if (!selection.requestId) setSelectionPending(false)
    setPaintRequest(selection.requestId ?? '')
    if (dirty && !saved) { setIncoming(selection); setMessage(selection.text ? '有新的选词，当前未收藏的编辑已保留。' : selection.reason + ' 当前编辑已保留。') } else acceptSelection(selection)
  }), [dirty, saved, acceptSelection])
  useEffect(() => {
    if (!paintRequest) return
    let next = 0
    const frame = requestAnimationFrame(() => { next = requestAnimationFrame(() => { if (activeCapture.current === paintRequest) { api.selectionPainted(paintRequest); setSelectionPending(false) } }) })
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(next) }
  }, [paintRequest])
  useEffect(() => { document.documentElement.dataset.theme = config?.theme ?? 'system' }, [config?.theme])
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { cancelAll(); void api.hide() } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key) }, [cancelAll])
  useEffect(() => api.onNavigate(setTab), [])
  const loadQueue = useCallback(async () => { try { const page = value(await api.queue({ search, state: filter, offset })); setItems(page.items); setTotal(page.total) } catch { setMessage('队列读取失败，原记录未清除。') } }, [search, filter, offset])
  useEffect(() => { if (tab === 'queue') queueMicrotask(() => { void loadQueue() }) }, [tab, loadQueue, status?.counts.acknowledged])
  async function save() {
    if (saved || saving || selectionPending) return
    cancel(); const generation = wordGeneration.current; setSaving(true)
    try {
      const common = { lemma: word.trim(), ...(surface.current && surface.current !== word.trim() ? { encounteredForm: surface.current } : {}), ...(resolution && resolution.lemma === word.trim() ? { lemmaResolution: resolution } : {}), lexicon: cleanLexicon(lexicon), meanings: senseMeanings(cleanLexicon(lexicon)), ...(source.trim() ? { source: source.trim() } : {}), ...(context.trim() ? { contexts: [{ id: contextId, text: context, ...(keepTranslation && context === sourceText && sentenceChinese.trim() && sentenceResult?.complete !== false ? { translation: sentenceChinese, translationLanguage: 'zh-CN' as const, translationSource: sentenceSource } : {}) }] } : {}), ...(tags.trim() ? { tags: tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) } : {}) }
      const fields = Object.fromEntries(Object.entries(german).filter(([, value]) => value !== '' && value !== undefined))
      const payload: VocabularyPayload = lang === 'en' ? { ...common, lang, ...(lexicon.phonetic ? { en: { phonetic: lexicon.phonetic } } : {}) } : { ...common, lang, de: fields }
      value(await api.save({ id: draftId, payload })); if (generation !== wordGeneration.current) return; setSaved(true); setDirty(false); setMessage('本机已收藏。等待上传，不会自动创建复习卡片。'); await refresh()
    } catch (error) { if (generation === wordGeneration.current) setMessage(error instanceof Error ? error.message : '保存失败，编辑内容保留。') }
    finally { if (generation === wordGeneration.current) setSaving(false) }
  }
  return <main>
    <header><div className="mark">P</div><div><h1>Polar Vocab <span>Capture</span> <small className="release-version">{status?.version}</small></h1><p>看懂一个词，留下一点积累</p></div><button className="quiet" onClick={() => { cancelAll(); void api.hide() }} aria-label="关闭窗口">×</button></header>
    <nav aria-label="桌面导航">{(['lookup', 'queue', 'settings'] as const).map((item) => <button key={item} aria-current={tab === item ? 'page' : undefined} onClick={() => setTab(item)}>{{ lookup: '查词与收藏', queue: '本地队列', settings: '设置' }[item]}</button>)}</nav>
    <div className="feedback" role="status">{message}</div>
    {status && !status.shortcutRegistered && <aside>快捷键被其他应用占用，仍可手动查词。请退出旧版或更换组合。<button type="button" onClick={() => setTab('settings')}>查看快捷键设置</button></aside>}
    {incoming && <aside>新选区：{incoming.text || '未读取到文字'}<div className="actions"><button onClick={() => acceptSelection(incoming)}>切换到新选词</button><button onClick={() => setIncoming(undefined)}>保留当前编辑</button></div></aside>}
    {tab === 'lookup' && <form onSubmit={(event) => { event.preventDefault(); void save() }}>
      <div className="row"><label className="grow">选中文字<textarea aria-label="单词或短语" maxLength={20000} rows={actualMode === 'word' ? 1 : 3} value={sourceText} disabled={saving || selectionPending} onChange={event => { acceptSelection({ text: event.target.value, source, method: 'manual', reason: '原文已保留；可查询或手动填写。' }, false); setDirty(true) }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && actualMode === 'word') { event.preventDefault(); void save() } }} autoFocus /></label><label>语言<select aria-label="查询语言" value={lang} disabled={saving || selectionPending} onChange={event => changeLanguage(event.target.value as Language)}><option value="en">英语</option><option value="de">德语</option></select></label></div>
      <div className="mode-line"><label>查询模式<select aria-label="查询模式" value={mode} onChange={event => { cancelAll(); setMode(event.target.value as QueryMode | 'auto'); if (event.target.value === 'sentence' || event.target.value === 'phrase') { setContext(sourceText); setContextId(sentenceContextId.current) } }}><option value="auto">自动识别</option><option value="word">单词词典</option><option value="phrase">短语</option><option value="sentence">整句翻译</option></select></label><small>当前：{{ word: '单词', phrase: '短语', sentence: '句子 / 段落' }[actualMode]}</small></div>
      {actualMode !== 'word' && <SentencePane text={sourceText} lang={lang} mode={actualMode} selectedStart={selectedStart} translation={sentenceChinese} translationState={sentenceResult} busy={busySentence} disabled={saving || selectionPending} online={config?.onlineLookup !== false} keepTranslation={keepTranslation} onKeepTranslation={setKeepTranslation} onTranslate={() => { void translateSentence(sourceText, lang) }} onTranslation={text => { cancelSentence(); sentenceRevision.current++; setSentenceChinese(text); setSentenceResult(undefined); setSentenceSource(editedSource(sentenceSource)); setDirty(true) }} onWord={chooseSurface} onCancel={cancelSentence} />}
      <div className="actions"><button type="button" onClick={() => { void lookup(word, lang) }} disabled={busyLookup || !word.trim() || saved || saving || selectionPending || config?.onlineLookup === false}>查询词典</button>{busyLookup && <button type="button" onClick={cancel}>取消查询</button>}<button type="button" className="secondary" disabled={selectionPending || saving} onClick={() => acceptSelection({ text: '', source: 'windows:manual', method: 'manual', reason: '请输入一个新词；仅收藏时才保存。' })}>新词</button></div>
      {(actualMode !== 'word' || sourceText.trim() !== word.trim()) && <label>当前收藏词条<input aria-label="当前收藏词条" value={word} maxLength={500} disabled={saved || saving || selectionPending} onChange={event => { cancel(); resetDictionary(); setWord(event.target.value); if (selectedStart === null) surface.current = event.target.value; setResolution(undefined); setDirty(true) }} placeholder="点击原文中的单词，或手动填写短语。" /></label>}
      {(resolution || candidates.length > 0) && <aside className="lemma-choices"><p>遇到的词形：<strong>{surface.current}</strong>{resolution ? ` → ${resolution.lemma}（${resolution.tags.join(' / ')}）` : ' · 存在多个或需确认的原型候选，请选择。'}</p><div className="actions"><button type="button" disabled={saved || saving} onClick={() => chooseLemma()}>保留原始词形</button>{candidates.map((candidate, index) => <button type="button" disabled={saved || saving} key={candidate.lemma + ':' + index} onClick={() => chooseLemma(candidate)}>{candidate.lemma} · {candidate.tags.join(' / ')}</button>)}</div><small>原型关系来自 Wiktionary；不是程序截断猜测。</small></aside>}
      <p className="hint">原词发送给 WiktApi（Wiktionary / Kaikki）；前4个义项的英文定义发送给 MyMemory 翻译（匿名约5,000字符/日）。来源分开标注，翻译需核对；查询可能被服务保留或交由翻译合作方处理。不会发送原句字段、标签或 GitHub 凭证。网络失败仍可编辑收藏。</p>
      {lexicon.phonetic && <p>音标：{lexicon.phonetic}</p>}
      <SenseEditor value={lexicon} onTranslate={id => { void translateSense(id) }} translatingIds={translatingIds} disabled={saved || saving || selectionPending} onChange={next => { dictionaryEdits.current++; setLexicon(next); setDirty(true) }} />
      {lexicon.forms.length > 0 && <details className="dictionary-forms"><summary>词典词形（{lexicon.forms.length}）</summary>{lexicon.forms.map(form => <p key={form.id}>{form.partOfSpeech} · {form.form} · {form.tags.join(' / ')} · Wiktionary</p>)}</details>}
      {lang === 'de' && <GermanFieldsEditor value={german} lexicon={lexicon} disabled={saved || saving || selectionPending} onChange={changeGerman} />}
      <button type="button" className="secondary" disabled={saved || saving || !word.trim()} onClick={() => { setContext(word.trim()); setContextId(crypto.randomUUID()); setKeepTranslation(false); setDirty(true) }}>将当前原文作为原句</button>
      <label>原句（选填）<textarea aria-label="原句" maxLength={20000} rows={2} value={context} disabled={saved || saving || selectionPending} onChange={(event) => { setContextId(crypto.randomUUID()); setContext(event.target.value); setKeepTranslation(false); setDirty(true) }} placeholder="只选中一个词时，不会自动获取上下文。" /></label>
      <div className="row"><label>标签（逗号分隔）<input aria-label="标签" value={tags} maxLength={8000} disabled={saved || saving || selectionPending} onChange={(event) => { setTags(event.target.value); setDirty(true) }} /></label><label>来源<input aria-label="来源" maxLength={2000} value={source} disabled={saved || saving || selectionPending} onChange={(event) => { setSource(event.target.value); setDirty(true) }} /></label></div>
      <div className="actions footer"><button className="primary" type="submit" disabled={!word.trim() || saved || saving || selectionPending}>{saved ? '已收藏到本机' : saving ? '正在保存…' : '收藏到生词队列'}</button><button className="secondary" type="button" onClick={() => { cancelAll(); void api.hide() }}>仅查看，关闭</button></div>
    </form>}
    {tab === 'queue' && <section><h2>本地收词队列</h2><p className="hint">收藏先保存在本机。已上传记录仍保留；Web 接收后才进入生词箱。</p><div className="counts">{status && Object.entries(status.counts).map(([key, count]) => <span key={key}>{labels[key as QueueState]} <b>{count}</b></span>)}</div><div className="row"><input aria-label="搜索队列" placeholder="搜索词形或释义" value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0) }} /><select aria-label="队列状态" value={filter} onChange={(event) => { setFilter(event.target.value as QueueState | 'all'); setOffset(0) }}><option value="all">全部状态</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div><div className="actions"><button onClick={() => { void perform(() => api.sync()) }} disabled={!status?.connected || status.syncing}>{status?.syncing ? '上传中…' : '手动同步'}</button><button onClick={() => { void perform(() => api.retry()).then(loadQueue) }}>重试失败队列</button><button onClick={() => { void perform(() => api.exportQueue()) }}>导出队列</button><button onClick={() => { void loadQueue() }}>刷新列表</button></div><p className="hint">共 {total} 条，本页 {items.length} 条</p>{!items.length ? <div className="empty">队列暂时没有匹配的记录。选一个词试试。</div> : <ul className="queue-list">{items.map(({ event, state, errorCode }) => <li key={event.id}><div><strong>{event.payload.lemma}</strong><span className="badge">{event.payload.lang.toUpperCase()} · {labels[state]}</span></div><p>{event.payload.meanings?.join('；') || '释义待补充'}</p>{event.payload.lexicon && <SenseDetails value={event.payload.lexicon} />}<small>{new Date(event.capturedAt).toLocaleString()}{errorCode ? ' · ' + errorCode : ''}</small></li>)}</ul>}<div className="actions"><button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 100))}>上一页</button><button disabled={offset + items.length >= total} onClick={() => setOffset(offset + 100)}>下一页</button></div></section>}
    {tab === 'settings' && config && <section><h2>快捷键与偏好</h2><label>全局快捷键<select aria-label="全局快捷键" value={config.shortcut} onChange={(event) => setConfig({ ...config, shortcut: event.target.value })}>{['Control+Alt+S', 'Control+Alt+D', 'Control+Shift+S', 'Control+Shift+D', 'Alt+Shift+S'].map((key) => <option key={key}>{key}</option>)}</select></label><p className="hint">当前注册：{status?.shortcutRegistered ? '成功' : '失败，请更换组合'}</p><div className="row"><label>默认语言<select aria-label="默认语言" value={config.language} onChange={(event) => setConfig({ ...config, language: event.target.value as Language })}><option value="en">英语</option><option value="de">德语</option></select></label><label>主题<select aria-label="主题" value={config.theme} onChange={(event) => setConfig({ ...config, theme: event.target.value as DesktopSettings['theme'] })}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label></div><label className="check"><input type="checkbox" checked={config.clipboardFallback} onChange={(event) => setConfig({ ...config, clipboardFallback: event.target.checked })} />允许纯文本剪贴板复制回退（其他格式保持不动）</label><label className="check"><input type="checkbox" checked={config.onlineLookup} onChange={event => { cancelAll(); setConfig({ ...config, onlineLookup: event.target.checked }) }} />允许向外部词典和翻译服务发送所选文本（关闭后仅本机手动输入）</label><label className="check"><input type="checkbox" checked={config.autoLookup} onChange={(event) => setConfig({ ...config, autoLookup: event.target.checked })} />触发划词后自动查询词典与中文候选</label><label className="check"><input type="checkbox" checked={config.autoSync} onChange={(event) => setConfig({ ...config, autoSync: event.target.checked })} />授权后自动批量上传（至少一分钟间隔，有限重试）</label><button onClick={() => { void perform(() => api.settings(config)) }}>保存设置</button>
      <ConnectionSettings status={status} api={api} perform={perform} onPreview={text => { setRememberDevice(false); setConnectionPreview(text) }} />
      <h2>本机数据与迁移</h2><p className="hint">迁移状态：{status?.migration.action}。旧版目录保留，新目录使用独立的版本保护和可验证备份。</p><button onClick={() => { void perform(() => api.importOldQueue()) }} disabled={status?.syncing || Object.values(status?.counts ?? {}).some(count => count > 0)}>从旧队列迁入（仅空库）</button><p className="path">{status?.dataDirectory}</p><p className="hint">队列：captures.sqlite；日志：logs/events.log（只记录固定分类，不记录选词或凭证）。便携程序退出或移除不删除本机数据。未启用开机自启动。</p><div className="actions"><button onClick={() => { void api.openWebsite() }}>打开 Polar Vocab 网站</button><button onClick={() => { cancelAll(); void api.quit() }}>退出并释放快捷键</button></div>
    </section>}
    {connectionPreview && <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-label="确认桌面采集连接" className="modal"><h2>确认采集目标</h2><p>{connectionPreview}</p><label className="check"><input type="checkbox" checked={rememberDevice} onChange={event => setRememberDevice(event.target.checked)} />记住此设备（Windows 凭证管理器）</label><p>确认后仅向此私有目标创建采集批次，原记录与复习状态保持。现在不会清空队列或云端。</p><div className="actions"><button className="primary" onClick={() => { setConnectionPreview(''); void perform(() => api.confirmConnection({ remember: rememberDevice })) }}>确认连接</button><button onClick={() => { setConnectionPreview(''); void api.cancelConnection() }}>取消</button></div></section></div>}
  </main>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
