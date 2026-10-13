import { cn } from '@/lib/utils'

/** A row of thin vertical ticks; the highlighted one is drawn in ink (or a state colour). */
export function TickSparkline({
  values,
  highlight = values.length - 1,
  highlightClass = 'bg-foreground',
  className,
}: {
  values: number[]
  highlight?: number
  highlightClass?: string
  className?: string
}) {
  const max = Math.max(1, ...values)
  return (
    <div className={cn('flex h-8 items-end gap-[3px]', className)} aria-hidden>
      {values.map((v, i) => (
        <span
          key={i}
          className={cn('w-[2px] rounded-full', i === highlight ? highlightClass : 'bg-muted-foreground/30')}
          style={{ height: `${Math.max(12, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}

export function KpiTile({
  label,
  value,
  footer,
  spark,
  as = 'div',
  active,
  onClick,
  className,
  ...rest
}: {
  label: React.ReactNode
  value: React.ReactNode
  footer?: React.ReactNode
  spark?: React.ReactNode
  as?: 'div' | 'button'
  active?: boolean
  onClick?: () => void
  className?: string
} & Omit<React.HTMLAttributes<HTMLElement>, 'onClick'>) {
  const Comp = as
  return (
    <Comp
      {...(as === 'button' ? { type: 'button' as const, 'aria-pressed': active } : {})}
      onClick={onClick}
      className={cn(
        'bg-card text-card-foreground shadow-card flex min-w-0 flex-col overflow-hidden rounded-xl border text-left',
        as === 'button' &&
          'hover:border-border-strong focus-visible:ring-ring/40 transition-[border-color,box-shadow] duration-150 outline-none focus-visible:ring-[3px]',
        active && 'border-foreground/70 ring-foreground/70 ring-1',
        className,
      )}
      {...rest}
    >
      <div className="flex items-start justify-between gap-3 px-3.5 pt-3 pb-2.5">
        <div className="min-w-0">
          <div className="label-mono flex items-center gap-1.5 truncate">{label}</div>
          <div className="num mt-1.5 text-2xl leading-none font-medium tracking-tight whitespace-nowrap sm:text-[1.75rem]">{value}</div>
        </div>
        {spark}
      </div>
      {footer !== undefined && (
        <div className="bg-frame/70 text-muted-foreground num mt-auto truncate border-t px-3.5 py-1.5 text-[11px]">
          {footer}
        </div>
      )}
    </Comp>
  )
}
