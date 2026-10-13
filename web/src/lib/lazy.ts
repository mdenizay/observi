import { lazy, type ComponentType } from 'react'

const KEY = 'observi-chunk-reload'

function getFlag() {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return '1' // storage unavailable → never auto-reload (avoids loops)
  }
}
function setFlag(v: string | null) {
  try {
    if (v === null) sessionStorage.removeItem(KEY)
    else sessionStorage.setItem(KEY, v)
  } catch {
    /* ignore */
  }
}

/**
 * React.lazy that survives redeploys: if a chunk from an old index.html no
 * longer exists, reload the page once (guarded by sessionStorage) to fetch
 * the new asset manifest. A second failure is rethrown to the error boundary.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithReload<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const mod = await factory()
      setFlag(null)
      return mod
    } catch (err) {
      if (!getFlag()) {
        setFlag(String(Date.now()))
        window.location.reload()
        return new Promise<never>(() => {}) // keep suspended until reload
      }
      throw err
    }
  })
}
