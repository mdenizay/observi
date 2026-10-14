import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import type { User } from '@/lib/types'

export const meKey = ['me'] as const

export function useMe() {
  return useQuery<User | null>({
    queryKey: meKey,
    queryFn: async () => {
      try {
        return await api.me()
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
    staleTime: 5 * 60_000,
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  })
}

/** Current user; only use inside routes guarded by RequireAuth. */
export function useUser(): User {
  const { data } = useMe()
  if (!data) throw new Error('useUser outside auth guard')
  return data
}

export function useIsAdmin() {
  const { data } = useMe()
  return data?.role === 'superadmin'
}

/** Whether the first-run setup wizard is still needed (only asked while nobody is signed in). */
export function useSetupStatus(enabled = true) {
  return useQuery({
    queryKey: ['setup-status'],
    queryFn: async () => {
      try {
        return (await api.setupStatus()).needed
      } catch {
        return false
      }
    },
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
}
