import { useEffect, useRef, useState } from 'react'
import { Check, Globe } from 'lucide-react'
import { LANGS, useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

/** Compact language picker (kept dependency-free: it ships in the login bundle). */
export function LanguageSwitcher({
  className,
  side = 'down',
  align = 'end',
}: {
  className?: string
  side?: 'up' | 'down'
  align?: 'start' | 'end'
}) {
  const { lang, setLang, t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = LANGS.find((l) => l.code === lang)

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('lang.label')}
        title={t('lang.label')}
        className="text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px]"
      >
        <Globe className="size-4" />
        <span>{current?.label}</span>
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'bg-popover text-popover-foreground absolute z-50 min-w-36 rounded-md border p-1 shadow-md',
            side === 'up' ? 'bottom-full mb-1' : 'top-full mt-1',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              role="menuitemradio"
              aria-checked={l.code === lang}
              onClick={() => {
                setLang(l.code)
                setOpen(false)
              }}
              className="hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
            >
              <span className="flex-1">{l.label}</span>
              {l.code === lang && <Check className="size-4" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
