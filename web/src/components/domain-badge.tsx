import { Globe } from 'lucide-react'
import { useI18n } from '@/i18n'
import { formatDate } from '@/lib/format'
import type { MonitorSummary } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * Domain-registration pill: amber "Domain 12d" (expiring) or red "Domain expired".
 * Nothing for ok/unknown. Single line with truncation so layouts don't jump.
 */
export function DomainBadge({ monitor, className }: { monitor: Pick<MonitorSummary, 'domain'>; className?: string }) {
  const { t } = useI18n()
  const d = monitor.domain
  if (!d || (d.status !== 'expiring' && d.status !== 'expired') || d.expires_at == null) return null
  const expired = d.status === 'expired'
  const date = formatDate(d.expires_at)
  const n = Math.max(0, d.days_left ?? 0)
  const tip = expired ? t('dom.tipExpired', { name: d.name, date }) : t('dom.tipExpiring', { name: d.name, date, n })
  return (
    <span
      title={tip}
      aria-label={tip}
      className={cn(
        'num inline-flex h-[22px] max-w-full shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap',
        expired ? 'border-down/30 bg-down/10 text-down' : 'border-pending/35 bg-pending/12 text-pending',
        className,
      )}
    >
      <Globe className="size-3 shrink-0" strokeWidth={2.25} />
      <span className="truncate">{expired ? t('dom.expiredShort') : t('dom.short', { n })}</span>
    </span>
  )
}
