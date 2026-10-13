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
        className="bg-popover text-popover-foreground shadow-pop pointer-events-none invisible absolute top-full left-1/2 z-50 mt-2 w-max max-w-64 -translate-x-1/2 rounded-lg border px-2.5 py-1.5 text-xs leading-snug font-normal tracking-normal normal-case opacity-0 transition-opacity duration-150 group-focus-within/tip:visible group-focus-within/tip:opacity-100 group-hover/tip:visible group-hover/tip:opacity-100"
      >
        {text}
      </span>
    </span>
  )
}

/**
 * Framed panel: a muted outer frame with a mono uppercase header strip, holding an
 * inner card for the content.
 */
export function Panel({
  title,
  info,
  actions,
  children,
  className,
  bodyClassName,
  bare = false,
}: {
  title?: React.ReactNode
  info?: string
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  /** Render children directly in the frame (no inner card). */
  bare?: boolean
}) {
  return (
    <section className={cn('bg-frame rounded-2xl border p-1', className)}>
      {(title || actions) && (
        <div className="flex min-h-9 items-center justify-between gap-2 px-2.5 py-1">
          <div className="label-mono flex min-w-0 items-center gap-1.5">
            <span className="truncate">{title}</span>
            {info && <InfoTip text={info} />}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
      )}
      {bare ? (
        children
      ) : (
        <div className={cn('bg-card text-card-foreground shadow-card rounded-xl border', bodyClassName)}>{children}</div>
      )}
    </section>
  )
}
