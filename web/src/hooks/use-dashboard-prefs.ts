import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { DEFAULT_PREFS, normalizePrefs, readLocalPrefs, writeLocalPrefs, type DashboardPrefs } from '@/lib/dashboard-prefs'

const prefsKey = ['preferences'] as const
let timer: ReturnType<typeof setTimeout> | undefined
let pending: DashboardPrefs | null = null

/** Debounced save: re-reads the stored object so keys we don't own are preserved. */
function scheduleSave(qc: QueryClient, next: DashboardPrefs) {
  pending = next
  clearTimeout(timer)
  timer = setTimeout(async () => {
    const dash = pending
    pending = null
    if (!dash) return
    try {
      const cur = await api.preferences()
      const merged = { ...cur.preferences, dashboard: dash }
      await api.savePreferences(merged)
      qc.setQueryData(prefsKey, { preferences: merged })
    } catch {
      /* the local copy keeps working; the next change retries */
    }
  }, 500)
}

/** Per-user dashboard layout: instant from localStorage, synced to the server. */
export function useDashboardPrefs() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: prefsKey, queryFn: api.preferences, staleTime: 5 * 60_000 })
  const [stored] = useState(readLocalPrefs)
  const [local, setLocal] = useState<DashboardPrefs | null>(null)
  const serverRaw = q.data?.preferences?.dashboard
  const prefs = useMemo(
    () => local ?? (serverRaw !== undefined ? normalizePrefs(serverRaw) : stored),
    [local, serverRaw, stored],
  )
  const ref = useRef(prefs)
  useEffect(() => {
    ref.current = prefs
  }, [prefs])
  useEffect(() => {
    if (serverRaw !== undefined) writeLocalPrefs(normalizePrefs(serverRaw))
  }, [serverRaw])

  const update = useCallback(
    (fn: (p: DashboardPrefs) => DashboardPrefs) => {
      const next = fn(ref.current)
      ref.current = next
      setLocal(next)
      writeLocalPrefs(next)
      scheduleSave(qc, next)
    },
    [qc],
  )
  const reset = useCallback(() => update(() => DEFAULT_PREFS), [update])
  return { prefs, update, reset }
}
