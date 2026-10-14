import { useEffect, useSyncExternalStore } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { Activity, Beat, BeatEvent, Monitor, MonitorSummary } from '@/lib/types'

const MAX_LIST_BEATS = 50
let heatTimer: ReturnType<typeof setTimeout> | undefined

// ---- connection status (for the "Live" indicator) ----
export type LiveStatus = 'connecting' | 'live' | 'reconnecting'
let liveStatus: LiveStatus = 'connecting'
const statusListeners = new Set<() => void>()
function setLiveStatus(s: LiveStatus) {
  if (s === liveStatus) return
  liveStatus = s
  statusListeners.forEach((l) => l())
}
export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(
    (cb) => {
      statusListeners.add(cb)
      return () => statusListeners.delete(cb)
    },
    () => liveStatus,
    () => 'connecting',
  )
}

function applyBeat(qc: QueryClient, ev: BeatEvent) {
  const beat: Beat = { t: ev.t, s: ev.s, l: ev.l, m: ev.m }
  let statusChanged = false

  qc.setQueryData<MonitorSummary[]>(['monitors'], (old) => {
    if (!old) return old
    return old.map((m) => {
      if (m.id !== ev.monitor_id) return m
      const prevBeat = m.beats[m.beats.length - 1]
      if (m.status !== ev.status || (prevBeat && prevBeat.s !== ev.s)) statusChanged = true
      return {
        ...m,
        status: ev.status,
        latency_ms: ev.l,
        last_check: ev.t,
        message: ev.m,
        beats: [...m.beats, beat].slice(-MAX_LIST_BEATS),
      }
    })
  })

  qc.setQueryData<Monitor>(['monitor', ev.monitor_id], (old) =>
    old ? { ...old, status: ev.status, latency_ms: ev.l, last_check: ev.t, message: ev.m } : old,
  )

  // ['heartbeats', id, hours] — append and drop points outside the window.
  for (const [key, data] of qc.getQueriesData<Beat[]>({ queryKey: ['heartbeats', ev.monitor_id] })) {
    if (!data) continue
    const hours = Number(key[2]) || 24
    const from = ev.t - hours * 3600_000
    const last = data[data.length - 1]
    if (last && last.t >= ev.t) continue
    let next = [...data, beat]
    if (next[0] && next[0].t < from) next = next.filter((b) => b.t >= from)
    qc.setQueryData(key, next)
  }

  if (statusChanged) {
    qc.invalidateQueries({ queryKey: ['events', ev.monitor_id] })
    qc.invalidateQueries({ queryKey: ['stats', ev.monitor_id] })
  }
}

/** Subscribes to /api/events (SSE) and patches the react-query cache. */
export function useLiveUpdates(enabled: boolean) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return
    let es: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let hadError = false
    let disposed = false

    const connect = () => {
      es = new EventSource('/api/events')
      es.addEventListener('open', () => {
        setLiveStatus('live')
        if (hadError) {
          // Resync anything missed while disconnected.
          qc.invalidateQueries({ queryKey: ['monitors'] })
          hadError = false
        }
      })
      es.addEventListener('beat', (e) => {
        try {
          applyBeat(qc, JSON.parse((e as MessageEvent).data) as BeatEvent)
        } catch {
          /* ignore malformed event */
        }
      })
      es.addEventListener('activity', (e) => {
        try {
          const a = JSON.parse((e as MessageEvent).data) as Activity
          const cached = qc.getQueryData<{ items: Activity[] }>(['activity'])
          if (!cached) return void qc.invalidateQueries({ queryKey: ['activity'] })
          if (cached.items.some((x) => x.id === a.id)) return
          qc.setQueryData(['activity'], { items: [a, ...cached.items].slice(0, 30) })
        } catch {
          /* ignore malformed event */
        }
      })
      es.addEventListener('monitors', () => {
        qc.invalidateQueries({ queryKey: ['monitors'] })
        // The status overview is cached server-side, so don't hammer it on bursts of changes.
        clearTimeout(heatTimer)
        heatTimer = setTimeout(() => qc.invalidateQueries({ queryKey: ['heatmap'] }), 2000)
      })
      es.addEventListener('error', () => {
        hadError = true
        setLiveStatus('reconnecting')
        // Browser retries on network errors by itself; a non-2xx response
        // (e.g. 401) closes the stream for good, so retry manually.
        if (es?.readyState === EventSource.CLOSED && !disposed) {
          es.close()
          // Refetching the list surfaces a 401 → login redirect if the session expired.
          qc.invalidateQueries({ queryKey: ['monitors'] })
          retry = setTimeout(connect, 5000)
        }
      })
    }
    connect()
    return () => {
      setLiveStatus('connecting')
      disposed = true
      clearTimeout(retry)
      es?.close()
    }
  }, [enabled, qc])
}
