import { Lock, ShieldAlert } from 'lucide-react'
import { useI18n } from '@/i18n'
import { certNeedsAttention, sslReasonLabel } from '@/lib/cert'
import { formatDate } from '@/lib/format'
import type { MonitorSummary } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * Compact SSL pill: red "SSL expired" / "SSL invalid" or amber "SSL 9d" (expiring).
 * Independent of the monitor's up/down status. Fixed height and truncation keep
 * card/row layouts stable.
 */
export function SslBadge({
  monitor,
  className,
}: {
  monitor: Pick<MonitorSummary, 'cert' | 'ssl_problem'>
  className?: string
}) {
  const { t } = useI18n()
  const { cert, ssl_problem } = monitor
  let tone: 'bad' | 'warn'
  let label: string
  let tip: string
  if (cert?.status === 'expired') {
    tone = 'bad'
    label = t('ssl.expiredShort')
    tip = t('ssl.tipExpired', { date: formatDate(cert.expires_at) })
  } else if (ssl_problem) {
    tone = 'bad'
    label = t('ssl.invalidShort')
    tip = t('ssl.tipProblem', { reason: sslReasonLabel(ssl_problem) })
  } else if (certNeedsAttention(cert)) {
    tone = 'warn'
    const n = Math.max(0, cert.days_left)
    label = t('ssl.short', { n })
    tip = t('ssl.tipExpiring', { date: formatDate(cert.expires_at), n })
  } else return null
  const Icon = tone === 'bad' ? ShieldAlert : Lock
  return (
    <span
      title={tip}
      aria-label={tip}
      className={cn(
        'num inline-flex h-[22px] max-w-full shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap',
        tone === 'bad' ? 'border-down/30 bg-down/10 text-down' : 'border-pending/35 bg-pending/12 text-pending',
        className,
      )}
    >
      <Icon className="size-3 shrink-0" strokeWidth={2.25} />
      <span className="truncate">{label}</span>
    </span>
  )
}
