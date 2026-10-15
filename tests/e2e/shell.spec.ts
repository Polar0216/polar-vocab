import { test, expect } from '@playwright/test'

const base = process.env.PAGES_BASE_PATH ?? '/polar-vocab/'
const pages = [
  { name: '首页', hash: '#/', title: '让每次遇见，都留下来。' },
  { name: '生词箱', hash: '#/inbox', title: '生词箱' },
  { name: '复习', hash: '#/review', title: '复习' },
  { name: '词汇库', hash: '#/vocabulary', title: '词汇库' },
  { name: '设置', hash: '#/settings', title: '设置' },
]

test('five routes, direct refresh, responsive navigation and themes', async ({ page, isMobile }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const response = await page.goto('.')
  expect(response?.status()).toBe(200)
  const navigation = page.getByRole('navigation', { name: isMobile ? '手机导航' : '主导航', exact: true })
  await expect(navigation).toBeVisible()
  await expect(page.getByRole('navigation', { name: isMobile ? '主导航' : '手机导航', exact: true })).not.toBeVisible()
  for (const route of pages) {
    await navigation.getByRole('link', { name: route.name, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: route.title, exact: true })).toBeVisible()
    await expect(navigation.getByRole('link', { name: route.name, exact: true })).toHaveAttribute('aria-current', 'page')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect((await page.reload())?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1, name: route.title, exact: true })).toBeVisible()
  }
  await page.getByRole('radio', { name: '深色', exact: true }).click()
  await expect(page.getByRole('radio', { name: '深色', exact: true })).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('settings-dark.png'), fullPage: true })
  await page.getByRole('radio', { name: '浅色', exact: true }).click()
  await expect(page.getByRole('radio', { name: '浅色', exact: true })).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await navigation.getByRole('link', { name: '首页', exact: true }).click()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true })
  await page.goto('./#/not-a-route')
  await expect(page.getByRole('heading', { level: 1, name: pages[0].title })).toBeVisible()
  expect(page.url()).toContain('#/')
  expect(errors).toEqual([])
})

test('production manifest, scoped service worker and offline refresh', async ({ page, context }) => {
  await page.goto('./#/inbox')
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 20_000 }).toBe(true)
  const registration = await page.evaluate(async () => {
    const worker = await navigator.serviceWorker.ready
    return { scope: worker.scope, scriptURL: worker.active?.scriptURL }
  })
  expect(registration.scope).toBe(`http://127.0.0.1:4173${base}`)
  expect(registration.scriptURL).toBe(`http://127.0.0.1:4173${base}sw.js`)
  const manifestURL = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(manifestURL).toBe(`${base}manifest.webmanifest`)
  const manifest = await (await context.request.get(manifestURL!)).json()
  expect(manifest.start_url).toBe(base)
  expect(manifest.scope).toBe(base)
  await context.setOffline(true)
  try {
    const response = await page.reload()
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: '生词箱', exact: true, level: 1 })).toBeVisible()
    const navigation = page.locator('nav:visible').first()
    await navigation.getByRole('link', { name: '复习', exact: true }).click()
    await expect(page.getByRole('heading', { name: '复习', exact: true, level: 1 })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: '复习', exact: true, level: 1 })).toBeVisible()
    const keys = await page.evaluate(async () => {
      const names = await caches.keys()
      return (await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map((request) => ({ url: request.url, authenticated: request.headers.has('Authorization') }))))).flat()
    })
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.every((key) => key.url.startsWith(`http://127.0.0.1:4173${base}`) && !key.authenticated)).toBe(true)
    expect(keys.some((key) => key.url.includes('api.github.com') || key.url.endsWith('/data/state.json'))).toBe(false)
  } finally { await context.setOffline(false) }
})

test('320px narrow screen does not overflow or hide navigation', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  for (const route of pages) {
    await page.goto(`./${route.hash}`)
    await expect(page.getByRole('heading', { level: 1, name: route.title, exact: true })).toBeVisible()
    await expect(page.getByRole('navigation', { name: '手机导航', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})
