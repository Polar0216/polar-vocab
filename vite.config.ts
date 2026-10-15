import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export function normalizeBase(value: string): string {
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(value)) {
    throw new Error('PAGES_BASE_PATH must be / or a slash-delimited pathname such as /polar-vocab/.')
  }
  return value
}

export default defineConfig(({ command, mode, isPreview }) => {
  const env = loadEnv(mode, process.cwd(), 'PAGES_')
  const base = normalizeBase(process.env.PAGES_BASE_PATH ?? env.PAGES_BASE_PATH ?? (command === 'serve' && !isPreview ? '/' : '/polar-vocab/'))
  return {
    base,
    build: { rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'database-vendor', test: /node_modules[\\/]dexie[\\/]/ }] } } } },
    plugins: [
      react(),
      tailwindcss(),
      { name: 'static-content-security', apply: 'build', transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.github.com; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; worker-src 'self'" }, injectTo: 'head-prepend' }] },
      VitePWA({
        registerType: 'prompt',
        injectRegister: null,
        scope: base,
        includeAssets: ['icon.svg', 'apple-touch-icon.png'],
        manifest: {
          id: base, name: 'Polar Vocab · 英德词汇空间', short_name: 'Polar Vocab',
          description: '个人英语、德语词汇收集与复习空间。', lang: 'zh-CN',
          start_url: base, scope: base, display: 'standalone',
          background_color: '#f5f7f5', theme_color: '#174e48',
          icons: [
            { src: `${base}pwa-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: `${base}pwa-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: `${base}pwa-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
          navigateFallback: `${base}index.html`,
          navigateFallbackAllowlist: [new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:index\\.html)?$`)],
          cleanupOutdatedCaches: true,
          skipWaiting: false,
          clientsClaim: true,
          // No runtimeCaching: no GitHub API, Authorization, or private data caches.
        },
        devOptions: { enabled: false },
      }),
    ],
  }
})
