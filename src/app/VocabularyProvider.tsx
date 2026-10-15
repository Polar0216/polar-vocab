import { liveQuery } from 'dexie'
import { useEffect, useState, type ReactNode } from 'react'
import type { LocalVocabularyService } from '../features/vocabulary/service'
import type { ClipboardPort } from '../integrations/clipboard/contracts'
import { VocabularyContext, errorMessage, type VocabularyContextValue } from './vocabulary-context'

export function VocabularyProvider({ service, clipboard, children }: { service: LocalVocabularyService; clipboard: ClipboardPort; children: ReactNode }) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<Omit<VocabularyContextValue, 'service' | 'clipboard' | 'retry'>>({ ready: false, loading: true, error: null, stats: null, settings: null, defaultLanguage: 'en', version: 0 })

  useEffect(() => {
    let active = true
    let subscription: { unsubscribe(): void } | undefined
    void service.initialize().then(() => {
      if (!active) return
      subscription = liveQuery(async () => {
        const [stats, settings, defaultLanguage] = await Promise.all([service.stats(), service.getSettings(), service.getDefaultLanguage()])
        return { stats, settings, defaultLanguage }
      }).subscribe({
        next: (data) => { if (active) setState((previous) => ({ ...data, ready: true, loading: false, error: null, version: previous.version + 1 })) },
        error: (error: unknown) => { if (active) setState((previous) => ({ ...previous, ready: false, loading: false, error: errorMessage(error) })) },
      })
    }).catch((error: unknown) => { if (active) setState((previous) => ({ ...previous, ready: false, loading: false, error: errorMessage(error) })) })
    return () => { active = false; subscription?.unsubscribe() }
  }, [service, attempt])

  return <VocabularyContext value={{ ...state, service, clipboard, retry: () => { setState((previous) => ({ ...previous, loading: true, error: null })); setAttempt((previous) => previous + 1) } }}>{children}</VocabularyContext>
}
