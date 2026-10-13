export interface Brand {
  name: string
  /** Logo URL (includes a cache-busting `?v=`), or null for the built-in pulse mark. */
  logo: string | null
}

declare global {
  interface Window {
    /** Injected into index.html by the server so the right name is known before first paint. */
    __OBSERVI_BRAND__?: Brand
  }
}

export const DEFAULT_BRAND: Brand = { name: 'Observi', logo: null }

/** Brand injected by the server (undefined in Vite dev → fetched from /api/branding). */
export function injectedBrand(): Brand | undefined {
  const b = typeof window !== 'undefined' ? window.__OBSERVI_BRAND__ : undefined
  if (b && typeof b.name === 'string' && b.name) return { name: b.name, logo: typeof b.logo === 'string' ? b.logo : null }
  return undefined
}
