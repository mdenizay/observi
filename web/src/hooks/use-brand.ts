import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { DEFAULT_BRAND, injectedBrand, type Brand } from '@/lib/brand'

export const brandKey = ['brand'] as const

/** Product name + logo. Seeded synchronously from the server-injected value when present. */
export function useBrand(): Brand {
  const { data } = useQuery<Brand>({
    queryKey: brandKey,
    queryFn: api.branding,
    initialData: injectedBrand,
    staleTime: 5 * 60_000,
  })
  return data ?? DEFAULT_BRAND
}

/** Keeps document.title and the favicon in sync with the brand. */
export function useBrandHead() {
  const { name, logo } = useBrand()
  useEffect(() => {
    document.title = name
  }, [name])
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    if (logo) {
      link.removeAttribute('type')
      link.href = logo
    } else {
      link.type = 'image/svg+xml'
      link.href = '/favicon.svg'
    }
  }, [logo])
}
