import { cn } from '@/lib/utils'

export function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/** Initials avatar with a stable hue derived from the name. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360
  return (
    <div
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-inset ring-black/5 dark:ring-white/10',
        className,
      )}
      style={{
        background: `oklch(0.8 0.06 ${h} / 0.35)`,
        color: `light-dark(oklch(0.4 0.09 ${h}), oklch(0.88 0.06 ${h}))`,
      }}
      aria-hidden
    >
      {initials(name)}
    </div>
  )
}
