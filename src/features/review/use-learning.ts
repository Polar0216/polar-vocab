import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import { useVocabulary, errorMessage } from '../../app/vocabulary-context'
import { learningDashboard, type LearningDashboard } from './daily-tasks'

export function useLearning() {
  const { service, ready } = useVocabulary()
  const [dashboard, setDashboard] = useState<LearningDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const refresh = () => setTick((value) => value + 1)
    const timer = window.setInterval(refresh, 15_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  useEffect(() => {
    if (!ready) return
    const subscription = liveQuery(async () => learningDashboard(await service.snapshot(), new Date())).subscribe({
      next: (value) => { setDashboard(value); setError(null) },
      error: (failure: unknown) => { setError(errorMessage(failure)); setDashboard(null) },
    })
    return () => subscription.unsubscribe()
  }, [service, ready, tick])
  return { dashboard: ready ? dashboard : null, error, refresh: () => setTick((value) => value + 1) }
}
