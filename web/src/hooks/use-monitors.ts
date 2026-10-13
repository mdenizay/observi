import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useMonitors() {
  return useQuery({ queryKey: ['monitors'], queryFn: api.monitors, refetchInterval: 60_000 })
}
