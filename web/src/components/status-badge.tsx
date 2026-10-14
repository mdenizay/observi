import { Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { statusLabel, uptimeTone, formatUptime } from '@/lib/format'
import type { MonitorStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

const variant: Record<MonitorStatus, 'up' | 'down' | 'pending' | 'paused' | 'maint' | 'muted'> = {
  up: 'up',
  down: 'down',
  pending: 'pending',
  paused: 'paused',
  maintenance: 'maint',
  unknown: 'muted',
}

export const statusDot: Record<MonitorStatus, string> = {
  up: 'bg-up',
  down: 'bg-down',
  pending: 'bg-pending',
  paused: 'bg-paused',
  maintenance: 'bg-maint',
  unknown: 'bg-muted-foreground/40',
}

export function StatusBadge({ status, className, title }: { status: MonitorStatus; className?: string; title?: string }) {
  return (
    <Badge variant={variant[status]} className={className} title={title}>
      {status === 'maintenance' ? (
        <Wrench className="size-3" strokeWidth={2.25} />
      ) : (
        <span className={cn('size-1.5 rounded-full', statusDot[status], status === 'down' && 'animate-pulse')} />
      )}
      {statusLabel(status)}
    </Badge>
  )
}

export function UptimeBadge({ value, className }: { value: number | null | undefined; className?: string }) {
  return (
    <Badge variant={uptimeTone(value)} className={cn('min-w-14 justify-center', className)}>
      {formatUptime(value, value !== null && value !== undefined && value < 100 ? 1 : 0)}
    </Badge>
  )
}
