import { Badge } from '@/components/ui/badge'
import { statusLabel, uptimeTone, formatUptime } from '@/lib/format'
import type { MonitorStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

const variant: Record<MonitorStatus, 'up' | 'down' | 'pending' | 'paused' | 'muted'> = {
  up: 'up',
  down: 'down',
  pending: 'pending',
  paused: 'paused',
  unknown: 'muted',
}

export const statusDot: Record<MonitorStatus, string> = {
  up: 'bg-up',
  down: 'bg-down',
  pending: 'bg-pending',
  paused: 'bg-paused',
  unknown: 'bg-muted-foreground/40',
}

/** Soft tinted pill with a status dot. */
export function StatusBadge({ status, className }: { status: MonitorStatus; className?: string }) {
  return (
    <Badge variant={variant[status]} className={cn('gap-1.5 pl-2', className)}>
      <span className={cn('size-1.5 rounded-full bg-current')} />
      {statusLabel(status)}
    </Badge>
  )
}

export function UptimeBadge({ value, className }: { value: number | null | undefined; className?: string }) {
  return (
    <Badge variant={uptimeTone(value)} className={cn('num min-w-14 justify-center', className)}>
      {formatUptime(value, value !== null && value !== undefined && value < 100 ? 1 : 0)}
    </Badge>
  )
}
