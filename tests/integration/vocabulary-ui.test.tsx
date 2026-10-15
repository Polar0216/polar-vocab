import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/app/App'
import { LocalVocabularyService } from '../../src/features/vocabulary/service'
import { PolarDatabase } from '../../src/storage/database'
import type { ClipboardPort } from '../../src/integrations/clipboard/contracts'

vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: () => ({ offlineReady: [false, vi.fn()], needRefresh: [false, vi.fn()], updateServiceWorker: vi.fn() }) }))
let service: LocalVocabularyService

beforeEach(async () => {
  window.location.hash = '#/inbox'
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  service = new LocalVocabularyService(new PolarDatabase(`ui-${crypto.randomUUID()}`))
  await service.initialize()
})
afterEach(async () => { cleanup(); service.db.close(); await service.db.delete(); vi.unstubAllGlobals() })

describe('本机词库交互', () => {
  it('最小英德录入成功后显示实际保存状态，重挂载仍有词条', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App service={service} />)
    const lemma = await screen.findByRole('textbox', { name: '单词或短语' })
    await user.type(lemma, 'Überraschung')
    await user.selectOptions(screen.getByRole('combobox', { name: '录入语言' }), 'de')
    await user.click(screen.getByRole('button', { name: '保存生词' }))
    expect(await screen.findByText('「Überraschung」已保存到本机生词箱。待同步操作已保留，请在设置查看云端确认状态。')).toBeInTheDocument()
    expect(await service.list()).toMatchObject([{ lemma: 'Überraschung', lang: 'de', status: 'inbox' }])
    expect((await service.snapshot()).cards).toHaveLength(0)
    unmount(); render(<App service={service} />)
    expect(await screen.findByRole('button', { name: '编辑 Überraschung' })).toBeInTheDocument()
  })

  it('存储失败后保留输入且不显示保存成功', async () => {
    vi.spyOn(service, 'add').mockRejectedValue(new Error('模拟存储写入失败'))
    const user = userEvent.setup()
    render(<App service={service} />)
    const input = await screen.findByRole('textbox', { name: '单词或短语' })
    await user.type(input, 'retain')
    await user.click(screen.getByRole('button', { name: '保存生词' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('模拟存储写入失败')
    expect(input).toHaveValue('retain')
    expect(screen.queryByText(/「retain」已保存/)).not.toBeInTheDocument()
    expect(await service.list()).toHaveLength(0)
  })

  it('可能重复的词条需要再次确认，已有释义不被覆盖', async () => {
    await service.add({ lang: 'en', lemma: 'hello', meanings: ['已有释义'] })
    const user = userEvent.setup()
    render(<App service={service} />)
    await user.type(await screen.findByRole('textbox', { name: '单词或短语' }), 'HELLO')
    await user.click(screen.getByRole('button', { name: '保存生词' }))
    expect(await screen.findByText('发现 1 条可能重复的词条')).toBeInTheDocument()
    expect(await service.list()).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: '仍然新增独立词条' }))
    await waitFor(async () => expect(await service.list()).toHaveLength(2))
    expect((await service.list()).find((entry) => entry.lemma === 'hello')?.meanings).toEqual(['已有释义'])
  })

  it('编辑不会丢失多个释义、原句和原句来源', async () => {
    const entry = await service.add({ lang: 'en', lemma: 'record', meanings: ['记录\n完整义项', '唱片'], contexts: [{ id: crypto.randomUUID(), text: 'a written record', source: 'source-a' }, { id: crypto.randomUUID(), text: 'play a record', source: 'source-b' }], source: 'standalone-source' })
    const user = userEvent.setup()
    render(<App service={service} />)
    await user.click(await screen.findByRole('button', { name: '编辑 record' }))
    const editor = within(screen.getByRole('dialog'))
    const lemma = editor.getByRole('textbox', { name: /词条原形/ })
    await user.clear(lemma); await user.type(lemma, 'records')
    await user.click(editor.getByRole('button', { name: '保存修改' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const stored = await service.get(entry.id)
    expect(stored?.meanings).toEqual(entry.meanings)
    expect(stored?.contexts).toEqual(entry.contexts)
    expect(stored?.source).toBe('standalone-source')
  })

  it('剪贴板只在主动点击读取，多行确认前不会落库', async () => {
    const readText = vi.fn().mockResolvedValue({ status: 'success', text: 'word\tlang\tmeaning\nÜbung\tde\t练习\nhello\ten\t你好' })
    const clipboard: ClipboardPort = { readText }
    const user = userEvent.setup()
    render(<App service={service} clipboard={clipboard} />)
    const read = await screen.findByRole('button', { name: '从剪贴板导入' })
    expect(readText).not.toHaveBeenCalled()
    await user.click(read)
    await waitFor(() => expect(screen.getByRole('textbox', { name: '剪贴板或手动粘贴文本' })).toHaveValue('word\tlang\tmeaning\nÜbung\tde\t练习\nhello\ten\t你好'))
    await user.click(within(screen.getByRole('region', { name: '剪贴板导入' })).getByRole('button', { name: '生成预览' }))
    expect(await screen.findByText('Übung')).toBeInTheDocument()
    expect(await service.list()).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: '确认导入有效行' }))
    await waitFor(async () => expect(await service.list()).toHaveLength(2))
    expect((await service.snapshot()).captures).toHaveLength(2)
  })

  it('剪贴板权限拒绝提供手动粘贴并保留原输入', async () => {
    const clipboard: ClipboardPort = { readText: vi.fn().mockResolvedValue({ status: 'denied', manualPasteRequired: true }) }
    const user = userEvent.setup()
    render(<App service={service} clipboard={clipboard} />)
    const input = await screen.findByRole('textbox', { name: '剪贴板或手动粘贴文本' })
    await user.type(input, 'behalten')
    await user.click(screen.getByRole('button', { name: '从剪贴板导入' }))
    expect(await screen.findByText('手动粘贴文本')).toBeInTheDocument()
    expect(input).toHaveValue('behalten')
    expect(await service.list()).toHaveLength(0)
  })

  it('其他页面更新后拒绝陈旧编辑，弹窗和输入保留', async () => {
    const entry = await service.add({ lang: 'en', lemma: 'branch', meanings: ['原释义'] })
    const user = userEvent.setup()
    render(<App service={service} />)
    await user.click(await screen.findByRole('button', { name: '编辑 branch' }))
    await service.update(entry.id, { lang: 'en', lemma: 'branch', meanings: ['另一页面的新释义'] }, { expectedRevisionId: entry.revisionId })
    const editor = within(screen.getByRole('dialog'))
    const input = editor.getByRole('textbox', { name: /词条原形/ })
    await user.clear(input); await user.type(input, 'my draft')
    await user.click(editor.getByRole('button', { name: '保存修改' }))
    expect(await editor.findByRole('alert')).toHaveTextContent('词条已被另一页面修改')
    expect(input).toHaveValue('my draft')
    expect((await service.get(entry.id))?.meanings).toEqual(['另一页面的新释义'])
  })

  it('删除先确认，取消无写入，确认保留永久删除证据', async () => {
    const entry = await service.add({ lang: 'de', lemma: 'Lösung' })
    const user = userEvent.setup()
    render(<App service={service} />)
    await user.click(await screen.findByRole('button', { name: '删除 Lösung' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }))
    expect(await service.get(entry.id)).toBeDefined()
    await user.click(screen.getByRole('button', { name: '删除 Lösung' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await service.list()).toHaveLength(0)
    expect((await service.snapshot()).tombstones.some((tombstone) => tombstone.entityId === entry.id)).toBe(true)
  })

  it('初始化失败仍保留导航与可读错误，不提供可写入口', async () => {
    vi.spyOn(service, 'initialize').mockRejectedValue(new Error('模拟数据库无法打开'))
    render(<App service={service} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('模拟数据库无法打开')
    expect(screen.getByRole('heading', { name: '生词箱', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存生词' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新打开' })).toBeEnabled()
  })
})
