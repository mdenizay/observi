import { Lock, ShieldAlert } from 'lucide-react'
import { certNeedsAttention } from '@/lib/cert'
import { useI18n } from '@/i18n'
import { formatDate } from '@/lib/format'
import type { CertInfo } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * Compact SSL pill for monitors whose certificate is expiring (amber) or expired (red).
 * Fixed height and truncation keep card/row layouts stable.
 */
export function SslBadge({ cert, className }: { cert: CertInfo | null | undefined; className?: string }) {
  const { t } = useI18n()
  if (!certNeedsAttention(cert)) return null
  const expired = cert.status === 'expired'
  const date = formatDate(cert.expires_at)
  const tip = expired
    ? t('ssl.tipExpired', { date })
    : t('ssl.tipExpiring', { date, n: Math.max(0, cert.days_left) })
  const label = expired ? t('ssl.expiredShort') : t('ssl.short', { n: Math.max(0, cert.days_left) })
  const Icon = expired ? ShieldAlert : Lock
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
      <Icon className="size-3 shrink-0" strokeWidth={2.25} />
      <span className="truncate">{label}</span>
    </span>
  )
}
