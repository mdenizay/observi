import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { statusDot } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { monitorTarget } from '@/lib/format'
import type { MonitorSummary } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'

export function MonitorPicker({
  monitors,
  value,
  onChange,
  annotate,
  maxHeight = 'max-h-56',
}: {
  monitors: MonitorSummary[]
  value: number[]
  onChange: (ids: number[]) => void
  /** Optional extra note shown next to a monitor (e.g. its current group). */
  annotate?: (m: MonitorSummary) => string | null | undefined
  maxHeight?: string
}) {
  const { t, lang } = useI18n()
  const [q, setQ] = useState('')
  const selected = useMemo(() => new Set(value), [value])
  const filtered = useMemo(() => {
    const term = q.trim().toLocaleLowerCase(lang)
    return monitors
      .filter(
        (m) =>
          !term ||
          m.name.toLocaleLowerCase(lang).includes(term) ||
          monitorTarget(m).toLocaleLowerCase(lang).includes(term),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  }, [monitors, q, lang])

  const toggle = (id: number, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(id)
    else next.delete(id)
    onChange([...next])
  }
  const selectAll = () => onChange([...new Set([...value, ...filtered.map((m) => m.id)])])
  const clear = () => {
    if (!q.trim()) return onChange([])
    const hide = new Set(filtered.map((m) => m.id))
    onChange(value.filter((id) => !hide.has(id)))
  }

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        <div className="relative min-w-40 flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('monitors.search')}
            className="h-8 pl-8"
          />
        </div>
        <Button type="button" size="xs" variant="ghost" onClick={selectAll} disabled={!filtered.length}>
          {t('common.selectAll')}
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={clear} disabled={!value.length}>
          {t('common.clear')}
        </Button>
      </div>
      <div className={cn(maxHeight, 'overflow-y-auto p-1')}>
        {filtered.length === 0 ? (
          <div className="text-muted-foreground p-4 text-center text-sm">
            {monitors.length ? t('common.noResults') : t('monitors.none')}
          </div>
        ) : (
          filtered.map((m) => (
            <label
              key={m.id}
              className="hover:bg-accent/60 flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm"
            >
              <Checkbox checked={selected.has(m.id)} onCheckedChange={(v) => toggle(m.id, v === true)} />
              <span className={cn('size-1.5 shrink-0 rounded-full', statusDot[m.active ? m.status : 'paused'])} />
              <span className="truncate">{m.name}</span>
              {annotate?.(m) && (
                <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[11px]">
                  {annotate(m)}
                </span>
              )}
              <span className="text-muted-foreground ml-auto hidden truncate text-xs sm:block">
                {monitorTarget(m)}
              </span>
            </label>
          ))
        )}
      </div>
      <div className="text-muted-foreground border-t px-3 py-1.5 text-xs">
        {t('picker.selected', { count: value.length, total: monitors.length })}
      </div>
    </div>
  )
}
