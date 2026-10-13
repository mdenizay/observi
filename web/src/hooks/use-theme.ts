import { useCallback, useSyncExternalStore } from 'react'

export type ThemeMode = 'dark' | 'light' | 'system'
const KEY = 'observi-theme'
const listeners = new Set<() => void>()

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* storage unavailable */
  }
  return 'dark'
}

const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
let mode: ThemeMode = typeof window !== 'undefined' ? readMode() : 'dark'

const resolve = (): 'dark' | 'light' => (mode === 'system' ? (mq?.matches === false ? 'light' : 'dark') : mode)

function apply() {
  document.documentElement.classList.toggle('dark', resolve() === 'dark')
  listeners.forEach((l) => l())
}

if (typeof window !== 'undefined') {
  apply()
  // "System" follows the OS setting live.
  mq?.addEventListener('change', () => mode === 'system' && apply())
}

export function setThemeMode(m: ThemeMode) {
  mode = m
  try {
    localStorage.setItem(KEY, m)
  } catch {
    /* storage unavailable */
  }
  apply()
}

const getSnapshot = () => `${mode}:${resolve()}`

export function useTheme() {
  const snap = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getSnapshot,
    () => 'dark:dark',
  )
  const [m, resolved] = snap.split(':') as [ThemeMode, 'dark' | 'light']
  const toggle = useCallback(() => setThemeMode(resolve() === 'dark' ? 'light' : 'dark'), [])
  return { mode: m, resolved, setMode: setThemeMode, toggle }
}
