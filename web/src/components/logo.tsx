import { cn } from '@/lib/utils'

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

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2 font-semibold tracking-tight', className)}>
      <LogoMark />
      <span className="text-base">Observi</span>
    </span>
  )
}
