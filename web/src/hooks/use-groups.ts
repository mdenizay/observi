import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

/** Superadmin only (GET /api/groups). */
export function useGroups(enabled = true) {
  return useQuery({ queryKey: ['groups'], queryFn: api.groups, enabled })
}
