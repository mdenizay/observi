import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useIsAdmin } from '@/hooks/use-auth'
import { translate } from '@/i18n'
import { api, errorMessage } from '@/lib/api'
import type { UpdateInfo } from '@/lib/types'

export const BUILD_VERSION = __APP_VERSION__
export const updateKey = ['update'] as const

/** Update status (superadmin only): polled every 10 min and on window focus. */
export function useUpdateInfo() {
  const isAdmin = useIsAdmin()
  return useQuery<UpdateInfo>({
    queryKey: updateKey,
    queryFn: api.updateInfo,
    enabled: isAdmin,
    refetchInterval: 10 * 60_000,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  })
}

// ---- apply flow: shared across the sidebar card, the user menu and Settings ----

type Phase = 'idle' | 'applying' | 'timeout'
interface ApplyState {
  phase: Phase
  target: string | null
}
let state: ApplyState = { phase: 'idle', target: null }
const listeners = new Set<() => void>()
function setState(s: ApplyState) {
  state = s
  listeners.forEach((l) => l())
}
let pollTimer: ReturnType<typeof setTimeout> | undefined
// Lets the poller push fresh update status into the react-query cache.
let pushInfo: ((i: UpdateInfo) => void) | null = null

const POLL_MS = 3000
const TIMEOUT_MS = 5 * 60_000

/** Polls /api/version until the server reports a different version than this build, then reloads. */
function watchForNewVersion(target: string | null) {
  clearTimeout(pollTimer)
  setState({ phase: 'applying', target })
  const started = Date.now()
  const tick = async () => {
    try {
      const { version } = await api.version()
      if (version && version !== BUILD_VERSION) {
        toast.success(translate('upd.updated', { v: version }))
        setTimeout(() => location.reload(), 800)
        return
      }
    } catch {
      /* server restarting — keep polling */
    }
    // The updater may report a failure without the server ever restarting.
    try {
      const info = await api.updateInfo()
      pushInfo?.(info)
      // The server may have restarted on the new version between the two requests.
      if (info.current && info.current !== BUILD_VERSION) {
        toast.success(translate('upd.updated', { v: info.current }))
        setTimeout(() => location.reload(), 800)
        return
      }
      if (info.state === 'error') {
        setState({ phase: 'idle', target: null })
        toast.error(translate('upd.error', { error: info.error ?? '—' }))
        return
      }
      // The updater gave up without restarting the server (still on the old version).
      if (info.state === 'idle' && Date.now() - started > POLL_MS * 2) {
        setState({ phase: 'timeout', target })
        return
      }
    } catch {
      /* server restarting */
    }
    if (Date.now() - started > TIMEOUT_MS) {
      setState({ phase: 'timeout', target })
      return
    }
    pollTimer = setTimeout(tick, POLL_MS)
  }
  pollTimer = setTimeout(tick, POLL_MS)
}

export function useApplyUpdate() {
  const qc = useQueryClient()
  const snap = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
    () => state,
  )

  useEffect(() => {
    pushInfo = (i) => qc.setQueryData(updateKey, i)
  }, [qc])

  const apply = useCallback(async () => {
    try {
      const info = await api.updateApply()
      qc.setQueryData(updateKey, info)
      toast.message(translate('upd.started'))
      watchForNewVersion(info.latest)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }, [qc])

  const checkAgain = useCallback(async () => {
    setState({ phase: 'idle', target: null })
    await qc.invalidateQueries({ queryKey: updateKey })
  }, [qc])

  return { ...snap, apply, checkAgain }
}

/** If the server already reports an update in progress (started elsewhere), follow it. */
export function useFollowServerUpdate(info: UpdateInfo | undefined) {
  useEffect(() => {
    if (info?.state === 'updating' && state.phase === 'idle') watchForNewVersion(info.latest)
  }, [info?.state, info?.latest])
}

/**
 * Non-blocking "new version" toast when the server runs a different version than
 * this page (checked on start and whenever the live connection reconnects).
 */
export async function checkServerVersion() {
  if (state.phase !== 'idle') return
  try {
    const { version } = await api.version()
    if (version && version !== BUILD_VERSION) {
      toast(translate('upd.newVersion'), {
        id: 'new-version',
        description: translate('upd.newVersionDesc', { v: version }),
        duration: Infinity,
        action: { label: translate('upd.reload'), onClick: () => location.reload() },
      })
    }
  } catch {
    /* ignore */
  }
}
