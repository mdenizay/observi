import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Small (i) icon with an accessible hover/focus tooltip. */
export function InfoTip({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn('group/tip relative inline-flex', className)}>
      <span
        tabIndex={0}
        aria-label={text}
        className="text-muted-foreground/70 hover:text-foreground focus-visible:text-foreground focus-visible:ring-ring/40 inline-flex rounded-full outline-none focus-visible:ring-2"
      >
        <Info className="size-3.5" />
      </span>
      <span
        role="tooltip"
        className="bg-popover text-popover-foreground shadow-pop pointer-events-none invisible absolute top-full left-1/2 z-50 mt-2 w-max max-w-64 -translate-x-1/2 rounded-lg border px-2.5 py-1.5 text-xs leading-snug font-normal opacity-0 transition-opacity duration-150 group-focus-within/tip:visible group-focus-within/tip:opacity-100 group-hover/tip:visible group-hover/tip:opacity-100"
      >
        {text}
      </span>
    </span>
  )
}

/**
 * Soft card section: a sentence-case title (+ optional (i) tooltip and visible
 * description) with actions on the right, and the content below.
 */
export function Panel({
  title,
  description,
  info,
  actions,
  children,
  className,
  bodyClassName,
  bare = false,
}: {
  title?: React.ReactNode
  description?: React.ReactNode
  info?: string
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  /** Render without the card surface (e.g. a grid of tiles). */
  bare?: boolean
}) {
  const header = (title || actions) && (
    <div className={cn('flex items-start justify-between gap-3', bare ? 'mb-3' : 'px-5 pt-4')}>
      <div className="min-w-0">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{title}</span>
          {info && <InfoTip text={info} />}
        </h3>
        {description && <p className="text-muted-foreground mt-1 text-[13px] leading-snug">{description}</p>}
      </div>
      {actions && <div className="-mt-1 flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  )
  if (bare)
    return (
      <section className={className}>
        {header}
        {children}
      </section>
    )
  return (
    <section className={cn('bg-card text-card-foreground shadow-card rounded-2xl border', className)}>
      {header}
      <div className={cn(title || actions ? 'pt-3' : '', bodyClassName)}>{children}</div>
    </section>
  )
}
