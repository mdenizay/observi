import { useCallback, useSyncExternalStore } from 'react'

export type Theme = 'dark' | 'light'
const KEY = 'observi-theme'
const listeners = new Set<() => void>()

function read(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function setTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark')
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l())
}

export function useTheme() {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    read,
    () => 'dark' as Theme,
  )
  const toggle = useCallback(() => setTheme(read() === 'dark' ? 'light' : 'dark'), [])
  return { theme, toggle }
}
