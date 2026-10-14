import { useRef } from 'react'
import { cn } from '@/lib/utils'

/** Underline-style tabs with tablist semantics and arrow-key navigation. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
  label: string
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((x) => x.id === value)
    let n = -1
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') n = 0
    else if (e.key === 'End') n = tabs.length - 1
    if (n < 0) return
    e.preventDefault()
    onChange(tabs[n].id)
    refs.current[tabs[n].id]?.focus()
  }
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="scrollbar-thin mb-5 flex gap-1 overflow-x-auto border-b">
      {tabs.map((tab) => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[tab.id] = el
            }}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={active}
            aria-controls={`panel-${tab.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              'focus-visible:ring-ring/50 relative -mb-px shrink-0 rounded-t-md px-3.5 py-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px]',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
            <span
              className={cn('absolute inset-x-2 bottom-0 h-0.5 rounded-full transition-colors', active ? 'bg-foreground' : 'bg-transparent')}
              aria-hidden
            />
          </button>
        )
      })}
    </div>
  )
}

