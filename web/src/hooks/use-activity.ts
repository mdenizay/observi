import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Activity } from '@/lib/types'

export const activityKey = ['activity'] as const
const SEEN_KEY = 'observi-activity-seen'

// ---- "last seen" marker, per browser (localStorage) ----
const listeners = new Set<() => void>()
function readSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0
  } catch {
    return 0
  }
}
let seen = readSeen()
function writeSeen(t: number) {
  seen = t
  try {
    localStorage.setItem(SEEN_KEY, String(t))
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l())
}

/** Recent activity feed; polled every 5 minutes and on focus as a fallback to SSE. */
export function useActivity() {
  const q = useQuery({
    queryKey: activityKey,
    queryFn: () => api.activity(30),
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    select: (d) => d.items,
  })
  const lastSeen = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => seen,
    () => 0,
  )
  const items: Activity[] = useMemo(() => q.data ?? [], [q.data])
  const unread = useMemo(() => items.filter((a) => a.t > lastSeen).length, [items, lastSeen])
  const markAllRead = useCallback(() => {
    const newest = items.reduce((m, a) => Math.max(m, a.t), 0)
    writeSeen(Math.max(newest, Date.now() - 1000))
  }, [items])
  return { ...q, items, unread, lastSeen, markAllRead }
}
