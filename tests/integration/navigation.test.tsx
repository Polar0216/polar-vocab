import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/app/App'
import { LocalVocabularyService } from '../../src/features/vocabulary/service'
import { PolarDatabase } from '../../src/storage/database'

let service: LocalVocabularyService

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ offlineReady: [false, vi.fn()], needRefresh: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}))

beforeEach(async () => {
  window.location.hash = '#/'
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  service = new LocalVocabularyService(new PolarDatabase(`navigation-${crypto.randomUUID()}`))
  await service.initialize()
})

afterEach(async () => { cleanup(); service.db.close(); await service.db.delete(); vi.unstubAllGlobals() })

describe('应用导航与页面骨架', () => {
  it('通过主导航访问五个页面，并标记当前页', async () => {
    const user = userEvent.setup()
    render(<App service={service} />)
    expect(screen.getByRole('heading', { level: 1, name: '让每次遇见，都留下来。' })).toBeInTheDocument()
    const nav = within(screen.getByRole('navigation', { name: '主导航' }))
    for (const name of ['生词箱', '复习', '词汇库', '设置']) {
      await user.click(nav.getByRole('link', { name }))
      expect(await screen.findByRole('heading', { level: 1, name })).toBeInTheDocument()
      expect(nav.getByRole('link', { name })).toHaveAttribute('aria-current', 'page')
      await waitFor(() => expect(screen.getByRole('main')).toHaveFocus())
    }
    await user.click(nav.getByRole('link', { name: '首页' }))
    expect(screen.getByRole('heading', { level: 1, name: '让每次遇见，都留下来。' })).toBeInTheDocument()
  })

  it('手机导航可访问收词页面，收词不会自动加入学习', async () => {
    const user = userEvent.setup()
    render(<App service={service} />)
    await user.click(within(screen.getByRole('navigation', { name: '手机导航' })).getByRole('link', { name: '生词箱' }))
    expect(await screen.findByRole('button', { name: '保存生词' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/inbox')
    expect(screen.queryByRole('button', { name: '开始复习' })).not.toBeInTheDocument()
  })

  it('支持直接打开 hash 路由，以及未知路径回到首页', async () => {
    window.location.hash = '#/review'
    const { unmount } = render(<App service={service} />)
    expect(await screen.findByRole('heading', { name: '复习', level: 1 })).toBeInTheDocument()
    unmount()
    window.location.hash = '#/unknown'
    render(<App service={service} />)
    expect(await screen.findByRole('heading', { name: '让每次遇见，都留下来。', level: 1 })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/')
  })

  it('主题选择可由键盘操作，保存后重新挂载仍保留', async () => {
    window.location.hash = '#/settings'
    const user = userEvent.setup()
    const { unmount } = render(<App service={service} />)
    const dark = await screen.findByRole('radio', { name: '深色' })
    await waitFor(() => expect(dark).not.toBeDisabled())
    dark.focus()
    await user.keyboard(' ')
    await waitFor(() => expect(dark).toBeChecked())
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'dark'))
    unmount()
    render(<App service={service} />)
    await waitFor(() => expect(screen.getByRole('radio', { name: '深色' })).toBeChecked())
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })

  it('首页显示真实本地统计，不伪造复习或远程同步数据', async () => {
    await service.add({ lang: 'de', lemma: 'Übung' })
    render(<App service={service} />)
    await waitFor(() => expect(screen.getByLabelText('德语词条总数')).toHaveTextContent('1'))
    expect(screen.getByLabelText('英语词条总数')).toHaveTextContent('0')
    expect(screen.queryByText('已同步')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('活动卡片数')).toHaveTextContent('0'))
  })
})
