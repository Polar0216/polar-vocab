import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { HomePage } from '../features/home/HomePage'
import { AppLayout } from './AppLayout'
import { ThemeProvider } from './ThemeProvider'
import { VocabularyProvider } from './VocabularyProvider'
import { LocalVocabularyService } from '../features/vocabulary/service'
import { BrowserClipboardAdapter } from '../integrations/clipboard/adapter'
import type { ClipboardPort } from '../integrations/clipboard/contracts'

const defaultService = new LocalVocabularyService()
const defaultClipboard = new BrowserClipboardAdapter()
const InboxPage = lazy(() => import('../features/inbox/InboxPage').then((module) => ({ default: module.InboxPage })))
const ReviewPage = lazy(() => import('../features/review/ReviewPage').then((module) => ({ default: module.ReviewPage })))
const VocabularyPage = lazy(() => import('../features/vocabulary/VocabularyPage').then((module) => ({ default: module.VocabularyPage })))
const SettingsPage = lazy(() => import('../features/settings/SettingsPage').then((module) => ({ default: module.SettingsPage })))

export function App({ service = defaultService, clipboard = defaultClipboard }: { service?: LocalVocabularyService; clipboard?: ClipboardPort } = {}) {
  return <VocabularyProvider service={service} clipboard={clipboard}><ThemeProvider><HashRouter><Routes>
    <Route element={<AppLayout />}>
      <Route index element={<HomePage />} />
      <Route path="inbox" element={<Suspense fallback={<p role="status">正在加载生词箱…</p>}><InboxPage /></Suspense>} />
      <Route path="review" element={<Suspense fallback={<p role="status">正在加载复习…</p>}><ReviewPage /></Suspense>} />
      <Route path="vocabulary" element={<Suspense fallback={<p role="status">正在加载词汇库…</p>}><VocabularyPage /></Suspense>} />
      <Route path="settings" element={<Suspense fallback={<p role="status">正在加载设置…</p>}><SettingsPage /></Suspense>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Routes></HashRouter></ThemeProvider></VocabularyProvider>
}
