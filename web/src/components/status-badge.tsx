import { Check, CircleDot, HelpCircle, Pause, X } from 'lucide-react'
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

const icon = { up: Check, down: X, pending: CircleDot, paused: Pause, unknown: HelpCircle } as const

export const statusDot: Record<MonitorStatus, string> = {
  up: 'bg-up',
  down: 'bg-down',
  pending: 'bg-pending',
  paused: 'bg-paused',
  unknown: 'bg-muted-foreground/40',
}

export function StatusBadge({ status, className }: { status: MonitorStatus; className?: string }) {
  const Icon = icon[status]
  return (
    <Badge variant={variant[status]} className={className}>
      <Icon className="size-3" strokeWidth={2.5} />
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
