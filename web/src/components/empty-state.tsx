import { cn } from '@/lib/utils'

type Kind = 'monitors' | 'search' | 'users' | 'groups' | 'notifications'

/** Small line illustration: muted strokes with one accent stroke. */
function Illustration({ kind }: { kind: Kind }) {
  const common = { fill: 'none', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg viewBox="0 0 120 80" className="h-16 w-24" aria-hidden>
      <rect x="10" y="12" width="100" height="58" rx="10" className="fill-muted stroke-border" strokeWidth="1" />
      {kind === 'monitors' && (
        <>
          <path d="M22 44h16l6-14 10 26 7-18 5 6h32" {...common} className="stroke-primary" />
          <circle cx="98" cy="44" r="3" className="fill-up" />
        </>
      )}
      {kind === 'search' && (
        <>
          <path d="M22 30h36M22 40h26M22 50h32" {...common} className="stroke-muted-foreground/40" />
          <circle cx="78" cy="40" r="11" {...common} className="stroke-primary" />
          <path d="M86 48l8 8" {...common} className="stroke-primary" />
        </>
      )}
      {kind === 'users' && (
        <>
          <circle cx="48" cy="34" r="7" {...common} className="stroke-muted-foreground/50" />
          <path d="M34 56c2-8 8-11 14-11s12 3 14 11" {...common} className="stroke-muted-foreground/50" />
          <circle cx="74" cy="36" r="6" {...common} className="stroke-primary" />
          <path d="M63 56c2-6 6-9 11-9s9 3 11 9" {...common} className="stroke-primary" />
        </>
      )}
      {kind === 'groups' && (
        <>
          <path d="M28 30h18l5 5h41v23H28z" {...common} className="stroke-primary" />
          <path d="M38 46h40" {...common} className="stroke-muted-foreground/40" />
        </>
      )}
      {kind === 'notifications' && (
        <>
          <path d="M60 24c-9 0-14 7-14 15v9l-5 6h38l-5-6v-9c0-8-5-15-14-15z" {...common} className="stroke-primary" />
          <path d="M55 58c1 3 3 4 5 4s4-1 5-4" {...common} className="stroke-muted-foreground/50" />
        </>
      )}
    </svg>
  )
}

export function EmptyState({
  kind,
  title,
  description,
  action,
  className,
}: {
  kind: Kind
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      <Illustration kind={kind} />
      <div className="grid max-w-sm gap-1">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </div>
      {action}
    </div>
  )
}
