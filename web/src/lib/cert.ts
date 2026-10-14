import { translate, type Key } from '@/i18n'
import type { CertInfo, MonitorSummary } from './types'

/** True when a certificate needs attention (expiring soon or expired). */
export const certNeedsAttention = (c: CertInfo | null | undefined): c is CertInfo =>
  !!c && (c.status === 'expiring' || c.status === 'expired')

type SslFields = Pick<MonitorSummary, 'cert' | 'ssl_problem'>

/** Any SSL issue: expiring/expired certificate or a validation problem on the last check. */
export const sslNeedsAttention = (m: SslFields) => certNeedsAttention(m.cert) || !!m.ssl_problem

/** Red-worthy SSL issue (expired or invalid), as opposed to merely expiring. */
export const sslIsBad = (m: SslFields) => m.cert?.status === 'expired' || !!m.ssl_problem

const reasonKeys: Record<string, Key> = {
  'certificate expired': 'ssl.reason.expired',
  'untrusted certificate': 'ssl.reason.untrusted',
  'certificate does not match the domain': 'ssl.reason.mismatch',
  'invalid certificate': 'ssl.reason.invalid',
}

/** Localized reason for a backend `ssl_problem` value (unknown reasons are shown raw). */
export function sslReasonLabel(reason: string): string {
  const key = reasonKeys[reason]
  return key ? translate(key) : reason
}
