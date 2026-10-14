import type { CertInfo } from './types'

/** True when a certificate needs attention (expiring soon or expired). */
export const certNeedsAttention = (c: CertInfo | null | undefined): c is CertInfo =>
  !!c && (c.status === 'expiring' || c.status === 'expired')
