import { createContext, useContext } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'

export const ThemeContext = createContext<{ preference: ThemePreference; setPreference: (value: ThemePreference) => Promise<void> } | undefined>(undefined)

export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used within ThemeProvider')
  return value
}
