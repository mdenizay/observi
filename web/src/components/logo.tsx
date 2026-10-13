import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useBrand } from '@/hooks/use-brand'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

/** Built-in pulse mark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-foreground" />
      <path
        d="M5 17h5l3-8 6 15 3-7h5"
        fill="none"
        className="stroke-up"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The configured logo in a rounded square (object-contain), or the built-in mark. */
export function BrandMark({ className }: { className?: string }) {
  const { logo } = useBrand()
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [logo])
  if (!logo || failed) return <LogoMark className={className} />
  return (
    <span className={cn('bg-card inline-flex size-7 shrink-0 overflow-hidden rounded-lg border', className)}>
      <img src={logo} alt="" className="size-full object-contain" onError={() => setFailed(true)} />
    </span>
  )
}

/** Brand block (mark + name) linking to the dashboard. */
export function Logo({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const { name } = useBrand()
  const { t } = useI18n()
  return (
    <Link
      to="/dashboard"
      onClick={onNavigate}
      aria-label={`${name} — ${t('nav.goHome')}`}
      className={cn(
        'hover:bg-accent/60 focus-visible:ring-ring/50 -mx-1.5 flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 font-semibold tracking-tight transition-colors outline-none focus-visible:ring-[3px]',
        className,
      )}
    >
      <BrandMark />
      <span className="truncate text-base">{name}</span>
    </Link>
  )
}
