import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/app/App'
import { LocalVocabularyService } from '../../src/features/vocabulary/service'
import { LocalReviewService } from '../../src/features/review/service'
import { PolarDatabase } from '../../src/storage/database'
import type { ReviewRating } from '../../src/domain'

vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: () => ({ offlineReady: [false, vi.fn()], needRefresh: [false, vi.fn()], updateServiceWorker: vi.fn() }) }))
let service: LocalVocabularyService
let reviews: LocalReviewService
beforeEach(async () => {
  window.location.hash = '#/review'
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  service = new LocalVocabularyService(new PolarDatabase('study-ui-' + crypto.randomUUID()))
  await service.initialize(); reviews = new LocalReviewService(service)
})
afterEach(async () => { cleanup(); service.db.close(); await service.db.delete(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function word(lemma: string, lang: 'en' | 'de' = 'en') {
  return service.add({ lang, lemma, meanings: ['答案隐藏测试'], status: 'learning' })
}
async function prepared(lemma = 'study-fixture', lang: 'en' | 'de' = 'en') {
  const entry = await word(lemma, lang)
  return (await reviews.create(await reviews.previewCreate([entry.id])))[0]
}
async function begin(user: ReturnType<typeof userEvent.setup>) {
  const button = await screen.findByRole('button', { name: '开始复习' })
  await waitFor(() => expect(button).not.toBeDisabled()); await user.click(button)
  return within(await screen.findByRole('region', { name: '当前学习卡片' }))
}

describe('真实本机学习交互', () => {
  it('single and batch card creation require the displayed count and confirmation', async () => {
    await word('one'); await word('two', 'de'); window.location.hash = '#/vocabulary'
    const user = userEvent.setup(); render(<App service={service} />)
    await user.click(await screen.findByRole('button', { name: '加入复习 one' }))
    let dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText('1', { selector: 'strong' })).toBeInTheDocument()
    expect(await service.db.cards.count()).toBe(0)
    await user.click(dialog.getByRole('button', { name: '取消' }))
    expect(await service.db.cards.count()).toBe(0)
    await user.click(screen.getByRole('checkbox', { name: /全选当前筛选/ }))
    await user.click(screen.getByRole('button', { name: '选中词条加入复习' }))
    dialog = within(await screen.findByRole('dialog')); expect(dialog.getByText('2', { selector: 'strong' })).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: '确认创建卡片' }))
    await waitFor(async () => expect(await service.db.cards.count()).toBe(2))
    await user.click(screen.getByRole('button', { name: '加入复习 one' }))
    expect(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认创建卡片' })).toBeDisabled()
  })
  it('hides the answer, protects input-focused keyboard actions and advances only after persistence', async () => {
    await prepared('first'); await prepared('second')
    const user = userEvent.setup(); render(<App service={service} />)
    let study = await begin(user)
    expect(study.queryByText('答案隐藏测试')).not.toBeInTheDocument()
    await user.keyboard('1'); expect(await service.db.reviewEvents.count()).toBe(0)
    await user.click(study.getByRole('button', { name: '词条详情' }))
    const dialog = within(screen.getByRole('dialog')); await user.click(dialog.getByRole('textbox', { name: '来源' })); await user.keyboard(' 1234')
    expect(await service.db.reviewEvents.count()).toBe(0)
    await user.click(dialog.getByRole('button', { name: '取消' })); await user.keyboard(' ')
    study = within(screen.getByRole('region', { name: '当前学习卡片' }))
    expect(study.getByText('答案隐藏测试')).toBeInTheDocument()
    await user.keyboard('3')
    await waitFor(async () => expect(await service.db.reviewEvents.count()).toBe(1))
    await waitFor(() => expect(screen.getByRole('button', { name: '显示答案' })).toBeInTheDocument())
    expect(screen.queryByLabelText('卡片答案')).not.toBeInTheDocument()
  })
  it.each(['Again', 'Hard', 'Good', 'Easy'] as ReviewRating[])('persists %s from the answer face', async (rating) => {
    await prepared(); const user = userEvent.setup(); render(<App service={service} />)
    const study = await begin(user); await user.click(study.getByRole('button', { name: '显示答案' }))
    await user.click(study.getByRole('button', { name: new RegExp('^' + rating) }))
    await waitFor(async () => expect((await service.db.reviewEvents.toArray())[0]?.rating).toBe(rating))
    expect(await service.db.reviewEvents.count()).toBe(1)
    expect(await screen.findByText(/评分已保存到本机/)).toBeInTheDocument()
  })
  it('shows a storage failure without moving the card or reporting success; retry saves once', async () => {
    await prepared(); const failure = vi.spyOn(LocalReviewService.prototype, 'grade').mockRejectedValueOnce(new Error('故障注入'))
    const user = userEvent.setup(); render(<App service={service} />)
    const study = await begin(user); await user.click(study.getByRole('button', { name: '显示答案' })); await user.click(study.getByRole('button', { name: /^Good/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('评分未确认成功')
    expect(await service.db.reviewEvents.count()).toBe(0)
    expect(screen.getByLabelText('卡片答案')).toBeInTheDocument()
    failure.mockRestore(); await user.click(study.getByRole('button', { name: /^Good/ }))
    await waitFor(async () => expect(await service.db.reviewEvents.count()).toBe(1))
  })
  it('supports language filtering, session pause/re-entry, card suspension/resume and quota settings', async () => {
    await prepared('english'); const german = await prepared('deutsch', 'de')
    const user = userEvent.setup(); const { unmount } = render(<App service={service} />)
    await user.selectOptions(await screen.findByRole('combobox', { name: '学习语言' }), 'de')
    let study = await begin(user); expect(study.getByRole('heading', { name: 'deutsch' })).toBeInTheDocument()
    await user.click(study.getByRole('button', { name: '暂停当前学习' }))
    study = await begin(user); expect(study.getByRole('heading', { name: 'deutsch' })).toBeInTheDocument()
    await user.click(study.getByRole('button', { name: '暂停当前学习' }))
    await user.click(screen.getByRole('button', { name: '暂停卡片 deutsch' }))
    await waitFor(async () => expect((await service.db.cards.get(german.id))?.suspended).toBe(true))
    await user.click(await screen.findByRole('button', { name: '恢复卡片 deutsch' }))
    await waitFor(async () => expect((await service.db.cards.get(german.id))?.suspended).toBe(false))
    unmount(); window.location.hash = '#/settings'; render(<App service={service} />)
    const en = await screen.findByRole('spinbutton', { name: '英语每日新卡上限' })
    await waitFor(() => expect(en).not.toBeDisabled()); await user.clear(en); await user.type(en, '0')
    await user.click(screen.getByRole('button', { name: '保存学习设置' }))
    await waitFor(async () => expect((await service.getSettings()).dailyNew.en).toBe(0))
    expect((await service.db.cards.get(german.id))?.fsrsState.reps).toBe(0)
  })
  it('blocks the frozen face when another page has already scored its old state', async () => {
    const card = await prepared(); const user = userEvent.setup(); render(<App service={service} />)
    const study = await begin(user); await user.click(study.getByRole('button', { name: '显示答案' }))
    await reviews.grade({ eventId: crypto.randomUUID(), cardId: card.id, expectedRevisionId: card.revisionId, expectedStateId: card.stateId, rating: 'Easy' })
    expect(await screen.findByText(/另一页面已更新、暂停或移除/)).toBeInTheDocument()
    expect(study.getByRole('button', { name: /^Good/ })).toBeDisabled()
    expect(await service.db.reviewEvents.count()).toBe(1)
  })
})

