import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

/** All tags visible to the current user, with monitor counts. */
export function useTagList() {
  return useQuery({ queryKey: ['tags'], queryFn: api.tags, select: (d) => d.items, staleTime: 30_000 })
}
