import { CircleArrowDown, CircleArrowUp } from 'lucide-react'
import { InfoTip } from '@/components/panel'
import { cn } from '@/lib/utils'

export interface Delta {
  /** Direction of the change. */
  dir: 'up' | 'down'
  /** Whether this change is good (green) or bad (red). */
  good: boolean
  text: string
}

export function DeltaPill({ delta }: { delta: Delta }) {
  const Icon = delta.dir === 'up' ? CircleArrowUp : CircleArrowDown
  return (
    <span
      className={cn(
        'num inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium',
        delta.good ? 'bg-up/12 text-up' : 'bg-down/12 text-down',
      )}
    >
      <Icon className="size-3.5" />
      {delta.text}
    </span>
  )
}

/** KPI card: label (+ info) top-left, optional delta pill top-right, big number, muted sub-line. */
export function KpiTile({
  label,
  info,
  value,
  sub,
  delta,
  as = 'div',
  active,
  onClick,
  className,
}: {
  label: React.ReactNode
  info?: string
  value: React.ReactNode
  sub?: React.ReactNode
  delta?: Delta
  as?: 'div' | 'button'
  active?: boolean
  onClick?: () => void
  className?: string
}) {
  const Comp = as
  return (
    <Comp
      {...(as === 'button' ? { type: 'button' as const, 'aria-pressed': active } : {})}
      onClick={onClick}
      className={cn(
        'bg-card text-card-foreground shadow-card flex min-w-0 flex-col rounded-2xl border p-4 text-left sm:p-5',
        as === 'button' &&
          'hover:bg-accent/40 focus-visible:ring-ring/40 transition-[background-color,box-shadow] duration-150 outline-none focus-visible:ring-[3px]',
        active && 'ring-foreground/40 bg-accent/40 ring-2',
        className,
      )}
    >
      <div className="flex min-h-6 items-center justify-between gap-2">
        <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-[13px]">
          <span className="truncate">{label}</span>
          {info && <InfoTip text={info} />}
        </div>
        {delta && <DeltaPill delta={delta} />}
      </div>
      <div className="num mt-2 text-[1.625rem] leading-tight font-semibold tracking-tight whitespace-nowrap sm:text-3xl">
        {value}
      </div>
      {sub !== undefined && <div className="text-muted-foreground mt-1 truncate text-xs">{sub}</div>}
    </Comp>
  )
}
