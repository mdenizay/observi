import { CircleCheck, CircleX, Globe, Lock, ShieldAlert, ShieldCheck, type LucideIcon } from 'lucide-react'
import type { useI18n } from '@/i18n'
import { formatDate, formatDuration } from '@/lib/format'
import { translateMessage } from '@/lib/messages'
import type { Activity } from '@/lib/types'

export const kindStyle: Record<Activity['kind'], { icon: LucideIcon; cls: string }> = {
  down: { icon: CircleX, cls: 'text-down bg-down/10' },
  up: { icon: CircleCheck, cls: 'text-up bg-up/10' },
  ssl_expiring: { icon: Lock, cls: 'text-pending bg-pending/12' },
  ssl_expired: { icon: ShieldAlert, cls: 'text-down bg-down/10' },
  ssl_renewed: { icon: ShieldCheck, cls: 'text-up bg-up/10' },
  domain_expiring: { icon: Globe, cls: 'text-pending bg-pending/12' },
  domain_expired: { icon: Globe, cls: 'text-down bg-down/10' },
  domain_renewed: { icon: Globe, cls: 'text-up bg-up/10' },
}

/** Localised title and optional subtitle for an activity item (shared by the bell and the dashboard). */
export function describeActivity(
  a: Activity,
  t: ReturnType<typeof useI18n>['t'],
  lang: string,
): { title: string; sub: string | null } {
  const d = a.data
  const name = a.monitor_name
  switch (a.kind) {
    case 'down':
      return { title: t('act.down', { name }), sub: d?.message ? translateMessage(d.message, lang as never) : null }
    case 'up':
      return {
        title: t('act.up', { name }),
        sub: d?.down_for_ms != null ? t('act.downFor', { duration: formatDuration(d.down_for_ms) }) : null,
      }
    case 'ssl_expiring':
      return {
        title: t('act.sslExpiring', { name, count: Math.max(0, d?.days_left ?? 0) }),
        sub: d?.expires_at ? t('ssl.validUntil', { date: formatDate(d.expires_at) }) : null,
      }
    case 'ssl_expired':
      return { title: t('act.sslExpired', { name }), sub: d?.expires_at ? t('ssl.expiredOn', { date: formatDate(d.expires_at) }) : null }
    case 'domain_expiring':
      return {
        title: t('act.domainExpiring', { domain: d?.domain ?? name, count: Math.max(0, d?.days_left ?? 0) }),
        sub: d?.expires_at ? t('ssl.validUntil', { date: formatDate(d.expires_at) }) : null,
      }
    case 'domain_expired':
      return {
        title: t('act.domainExpired', { domain: d?.domain ?? name }),
        sub: d?.expires_at ? t('ssl.expiredOn', { date: formatDate(d.expires_at) }) : null,
      }
    case 'domain_renewed':
      return {
        title: t('act.domainRenewed', { domain: d?.domain ?? name, date: d?.expires_at ? formatDate(d.expires_at) : '—' }),
        sub: null,
      }
    default:
      return { title: t('act.sslRenewed', { name }), sub: d?.expires_at ? t('ssl.validUntil', { date: formatDate(d.expires_at) }) : null }
  }
}
