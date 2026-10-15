import { createContext, useContext } from 'react'
import type { AppSettings, Language } from '../domain'
import type { LocalVocabularyService } from '../features/vocabulary/service'
import type { ClipboardPort } from '../integrations/clipboard/contracts'

export type VocabularyStats = Awaited<ReturnType<LocalVocabularyService['stats']>>
export interface VocabularyContextValue {
  service: LocalVocabularyService
  clipboard: ClipboardPort
  ready: boolean
  loading: boolean
  error: string | null
  stats: VocabularyStats | null
  settings: AppSettings | null
  defaultLanguage: Language
  version: number
  retry(): void
}
export const VocabularyContext = createContext<VocabularyContextValue | undefined>(undefined)
export function useVocabulary() {
  const value = useContext(VocabularyContext)
  if (!value) throw new Error('useVocabulary must be used within VocabularyProvider')
  return value
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请保留当前内容并重试。'
}
