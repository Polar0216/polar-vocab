import { useEffect, type ReactNode } from 'react'
import { ThemeContext, type ThemePreference } from './theme-context'
import { useVocabulary } from './vocabulary-context'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings, service } = useVocabulary()
  const preference = settings?.theme ?? 'system'
  const setPreference = async (value: ThemePreference) => { await service.updateSettings({ theme: value }) }

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference
      document.documentElement.dataset.theme = theme
      document.documentElement.style.colorScheme = theme
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [preference])

  return <ThemeContext value={{ preference, setPreference }}>{children}</ThemeContext>
}
