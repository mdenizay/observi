import { memo, useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { statusDot } from '@/components/status-badge'
import { useI18n } from '@/i18n'
import { api, errorMessage } from '@/lib/api'
import type { HeatRange } from '@/lib/dashboard-prefs'
import { formatUptime } from '@/lib/format'
import type { HeatmapItem, MonitorSummary } from '@/lib/types'
import { cn } from '@/lib/utils'

const RANGES: HeatRange[] = ['24h', '7d', '30d']

/** Cell colours: a mostly-green board stays calm (muted green), trouble stands out. */
const cellCls: Record<string, string> = {
  u: 'bg-up/60 dark:bg-up/45',
  w: 'bg-pending',
  d: 'bg-down',
  m: 'bg-maint/70',
  p: 'bg-pending/40',
  x: 'bg-paused/45',
  '-': 'bg-foreground/[0.05]',
}
const legend = [
  ['u', 'heat.s.u'],
  ['w', 'heat.s.w'],
  ['d', 'heat.s.d'],
  ['m', 'heat.s.m'],
  ['p', 'heat.s.p'],
  ['x', 'heat.s.x'],
  ['-', 'heat.s.none'],
] as const

interface Tip {
  id: number
  k: number
  x: number
  y: number
}

const hasTrouble = (i: HeatmapItem) => /[dw]/.test(i.cells)

const Row = memo(function Row({
  item,
  dot,
  activeK,
  label,
  onHover,
  onLeave,
  onOpen,
  onKey,
  onFocusRow,
}: {
  item: HeatmapItem
  dot: string
  activeK: number
  label: string
  onHover: (id: number, k: number, el: HTMLElement) => void
  onLeave: () => void
  onOpen: (id: number) => void
  onKey: (e: React.KeyboardEvent<HTMLDivElement>, id: number, len: number) => void
  onFocusRow: (e: React.FocusEvent<HTMLDivElement>, id: number, len: number) => void
}) {
  const cells = item.cells
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={() => onOpen(item.id)}
      onKeyDown={(e) => onKey(e, item.id, cells.length)}
      onFocus={(e) => onFocusRow(e, item.id, cells.length)}
      onBlur={onLeave}
      data-row={item.id}
      className="hover:bg-accent/40 focus-visible:bg-accent/50 focus-visible:ring-ring/50 group flex cursor-pointer items-center gap-2 rounded-md px-1 py-[3px] outline-none focus-visible:ring-2"
    >
      <div className="bg-card group-hover:bg-accent/40 sticky left-0 z-10 flex w-[8rem] shrink-0 items-center gap-2 rounded-l-md pr-1 sm:w-48 lg:w-56">
        <span className={cn('size-2 shrink-0 rounded-full', dot)} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{item.name}</span>
        <span className="num text-muted-foreground w-11 shrink-0 text-right text-xs">
          {item.uptime === null ? '—' : formatUptime(item.uptime, 1)}
        </span>
      </div>
      <div
        className="grid min-w-0 flex-1 gap-px sm:gap-[2px]"
        style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(2px, 1fr))` }}
        onMouseOver={(e) => {
          const k = (e.target as HTMLElement).dataset.i
          if (k !== undefined) onHover(item.id, Number(k), e.target as HTMLElement)
        }}
        onMouseLeave={onLeave}
        aria-hidden
      >
        {Array.from(cells, (c, i) => (
          <div
            key={i}
            data-i={i}
            className={cn('h-4 rounded-[2px]', cellCls[c] ?? cellCls['-'], i === activeK && 'ring-foreground/70 ring-2')}
          />
        ))}
      </div>
    </div>
  )
})

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function fmt(lang: string, opts: Intl.DateTimeFormatOptions) {
  const key = lang + JSON.stringify(opts)
  let f = fmtCache.get(key)
  if (!f) fmtCache.set(key, (f = new Intl.DateTimeFormat(lang, opts)))
  return f
}
function bucketLabel(start: number, end: number, lang: string) {
  const full = fmt(lang, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const time = fmt(lang, { hour: '2-digit', minute: '2-digit' })
  const sameDay = new Date(start).toDateString() === new Date(end).toDateString()
  return `${full.format(start)} – ${sameDay ? time.format(end) : full.format(end)}`
}

export function Heatmap({
  monitors,
  range,
  grouped,
  expanded,
  onChange,
  onOpen,
}: {
  monitors: MonitorSummary[] | undefined
  range: HeatRange
  grouped: boolean
  expanded: boolean
  onChange: (p: { range?: HeatRange; grouped?: boolean; expanded?: boolean }) => void
  onOpen: (id: number) => void
}) {
  const { t, lang } = useI18n()
  const q = useQuery({
    queryKey: ['heatmap', range],
    queryFn: () => api.heatmap(range),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })
  const [tip, setTip] = useState<Tip | null>(null)
  const data = q.data

  const dots = useMemo(() => {
    const m = new Map<number, string>()
    for (const x of monitors ?? []) m.set(x.id, statusDot[x.active ? x.status : 'paused'])
    return m
  }, [monitors])

  const sorted = useMemo(() => {
    return [...(data?.items ?? [])].sort((a, b) => {
      const ta = hasTrouble(a)
      const tb = hasTrouble(b)
      if (ta !== tb) return ta ? -1 : 1
      if (ta) {
        const d = (a.uptime ?? 101) - (b.uptime ?? 101)
        if (d !== 0) return d
      }
      return a.name.localeCompare(b.name, lang)
    })
  }, [data, lang])

  /** Current state per monitor: live state when known, else the last bucket that has data. */
  const nowState = useMemo(() => {
    const live = new Map((monitors ?? []).map((m) => [m.id, m]))
    const out = new Map<number, string>()
    for (const it of sorted) {
      const m = live.get(it.id)
      if (m) {
        out.set(it.id, !m.active ? 'x' : m.status === 'up' ? 'u' : m.status === 'down' ? 'd' : m.status === 'maintenance' ? 'm' : m.status === 'paused' ? 'x' : 'p')
        continue
      }
      const last = [...it.cells].reverse().find((c) => c !== '-')
      out.set(it.id, last === 'w' ? 'p' : (last ?? '-'))
    }
    return out
  }, [sorted, monitors])
  const problems = useMemo(() => sorted.filter((i) => hasTrouble(i) || nowState.get(i.id) === 'd'), [sorted, nowState])
  const shown = expanded ? sorted : problems

  const sections = useMemo(() => {
    if (!grouped) return [{ key: '', name: '', items: shown }]
    const map = new Map<string, HeatmapItem[]>()
    for (const i of shown) map.set(i.group_name ?? '', [...(map.get(i.group_name ?? '') ?? []), i])
    return [...map.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, lang)))
      .map(([key, items]) => ({ key, name: key || t('dash.ungrouped'), items }))
  }, [shown, grouped, lang, t])

  const wall = useMemo(() => {
    if (!grouped) return [{ key: '', name: '', items: sorted }]
    const map = new Map<string, HeatmapItem[]>()
    for (const i of sorted) map.set(i.group_name ?? '', [...(map.get(i.group_name ?? '') ?? []), i])
    return [...map.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, lang)))
      .map(([key, items]) => ({ key, name: key || t('dash.ungrouped'), items }))
  }, [sorted, grouped, lang, t])

  const subtitle = useMemo(() => {
    if (!monitors) return null
    const up = monitors.filter((m) => m.active && m.status === 'up').length
    const ups = monitors.map((m) => m.uptime_24h).filter((v): v is number => v !== null)
    return ups.length
      ? t('heat.subtitle', { up, total: monitors.length, uptime: formatUptime(ups.reduce((a, b) => a + b, 0) / ups.length, 1) })
      : t('heat.subtitleBare', { up, total: monitors.length })
  }, [monitors, t])

  const place = useCallback((id: number, k: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const x = Math.min(Math.max(r.left + r.width / 2, 130), window.innerWidth - 130)
    setTip((p) => (p && p.id === id && p.k === k ? p : { id, k, x, y: r.top }))
  }, [])
  const leave = useCallback(() => setTip(null), [])
  const keyNav = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, id: number, len: number) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        return onOpen(id)
      }
      if (e.key === 'Escape') return setTip(null)
      const cur = tip && tip.id === id ? tip.k : len - 1
      const next =
        e.key === 'ArrowLeft' ? cur - 1 : e.key === 'ArrowRight' ? cur + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? len - 1 : null
      if (next === null) return
      e.preventDefault()
      const k = Math.min(len - 1, Math.max(0, next))
      const el = e.currentTarget.querySelector<HTMLElement>(`[data-i="${k}"]`)
      if (el) place(id, k, el)
    },
    [tip, place, onOpen],
  )
  const focusRow = useCallback(
    (e: React.FocusEvent<HTMLDivElement>, id: number, len: number) => {
      if (e.target !== e.currentTarget || !e.currentTarget.matches(':focus-visible')) return
      const el = e.currentTarget.querySelector<HTMLElement>(`[data-i="${len - 1}"]`)
      if (el) place(id, len - 1, el)
    },
    [place],
  )

  const [wallFocus, setWallFocus] = useState<number | null>(null)
  const placeSquare = useCallback((id: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const x = Math.min(Math.max(r.left + r.width / 2, 130), window.innerWidth - 130)
    setTip((p) => (p && p.id === id && p.k === -1 ? p : { id, k: -1, x, y: r.top }))
  }, [])
  const wallKey = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Escape') return setTip(null)
    const sq = Array.from(e.currentTarget.closest('[data-wall]')?.querySelectorAll<HTMLButtonElement>('[data-sq]') ?? [])
    const i = sq.indexOf(e.currentTarget)
    let next: HTMLButtonElement | undefined
    if (e.key === 'ArrowRight') next = sq[i + 1]
    else if (e.key === 'ArrowLeft') next = sq[i - 1]
    else if (e.key === 'Home') next = sq[0]
    else if (e.key === 'End') next = sq[sq.length - 1]
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const dir = e.key === 'ArrowDown' ? 1 : -1
      const cur = e.currentTarget
      const cand = sq.filter((o) => (o.offsetTop - cur.offsetTop) * dir > 4)
      if (cand.length) {
        const rowTop = dir === 1 ? Math.min(...cand.map((o) => o.offsetTop)) : Math.max(...cand.map((o) => o.offsetTop))
        next = cand.filter((o) => o.offsetTop === rowTop).sort((a, b) => Math.abs(a.offsetLeft - cur.offsetLeft) - Math.abs(b.offsetLeft - cur.offsetLeft))[0]
      }
    } else return
    e.preventDefault()
    next?.focus()
  }, [])

  const tipItem = tip && data?.items.find((i) => i.id === tip.id)
  const tipText =
    tip && tipItem && tip.k === -1
      ? t('heat.wallTip', {
          name: tipItem.name,
          state: t(`heat.s.${nowState.get(tipItem.id) === '-' ? 'none' : ((nowState.get(tipItem.id) ?? 'u') as 'u')}` as 'heat.s.u'),
          uptime: tipItem.uptime === null ? '—' : formatUptime(tipItem.uptime, 2),
        })
      : tip && tipItem && data
      ? t('heat.cell', {
          name: tipItem.name,
          time: bucketLabel(data.from + tip.k * data.bucket_ms, data.from + (tip.k + 1) * data.bucket_ms, lang),
          state: t(`heat.s.${tipItem.cells[tip.k] === '-' ? 'none' : (tipItem.cells[tip.k] as 'u')}` as 'heat.s.u'),
        })
      : null

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-4 pt-4 pb-3 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{t('heat.title')}</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">{subtitle ?? <Skeleton className="mt-1 h-3.5 w-40" />}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Switch checked={grouped} onCheckedChange={(v) => onChange({ grouped: v })} aria-label={t('heat.groupBy')} className="scale-90" />
            <span className="text-muted-foreground">{t('heat.groupBy')}</span>
          </label>
          <div className="bg-muted flex rounded-lg border p-0.5" role="radiogroup" aria-label={t('heat.range')}>
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={range === r}
                onClick={() => onChange({ range: r })}
                className={cn(
                  'text-muted-foreground focus-visible:ring-ring/50 rounded-md px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2',
                  range === r && 'bg-card text-foreground shadow-xs',
                )}
              >
                {t(`range.${r}.short` as const)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-3 text-[11px] sm:px-5" aria-hidden>
        {legend.map(([c, key]) => (
          <span key={c} className="flex items-center gap-1.5">
            <span className={cn('size-2.5 rounded-[2px]', cellCls[c])} />
            {t(key)}
          </span>
        ))}
      </div>

      {q.isPending ? (
        <div className="px-4 pb-3 sm:px-5">
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: 24 }, (_, i) => (
              <Skeleton key={i} className="size-3.5 rounded-[4px]" />
            ))}
          </div>
        </div>
      ) : q.isError ? (
        <div className="flex flex-wrap items-center gap-3 px-4 py-4 text-sm sm:px-5">
          <span className="text-muted-foreground min-w-0 flex-1">
            {t('heat.failed')} {errorMessage(q.error)}
          </span>
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : sorted.length === 0 ? (
        <p className="text-muted-foreground px-4 py-6 text-center text-sm sm:px-5">{t('heat.empty')}</p>
      ) : (
        <>
          <div data-wall className="flex flex-wrap gap-x-5 gap-y-3 px-4 pb-4 sm:px-5" role="group" aria-label={t('heat.wall')}>
            {wall.map((g) => (
              <div key={g.key} className="min-w-0">
                {grouped && (
                  <div className="text-muted-foreground mb-1.5 flex max-w-full items-center gap-1.5 text-[11px]">
                    <span className="text-foreground truncate font-semibold">{g.name}</span>
                    <span className="num">{g.items.length}</span>
                  </div>
                )}
                <div className="flex flex-wrap gap-1">
                  {g.items.map((it, idx) => {
                    const st = nowState.get(it.id) ?? '-'
                    const focusable = wallFocus === null ? g === wall[0] && idx === 0 : wallFocus === it.id
                    return (
                      <button
                        key={it.id}
                        type="button"
                        data-sq
                        tabIndex={focusable ? 0 : -1}
                        aria-label={t('heat.wallTip', {
                          name: it.name,
                          state: t(`heat.s.${st === '-' ? 'none' : (st as 'u')}` as 'heat.s.u'),
                          uptime: it.uptime === null ? '—' : formatUptime(it.uptime, 2),
                        })}
                        onClick={() => onOpen(it.id)}
                        onMouseEnter={(e) => placeSquare(it.id, e.currentTarget)}
                        onMouseLeave={leave}
                        onFocus={(e) => {
                          setWallFocus(it.id)
                          if (e.currentTarget.matches(':focus-visible')) placeSquare(it.id, e.currentTarget)
                        }}
                        onBlur={leave}
                        onKeyDown={wallKey}
                        className={cn(
                          'focus-visible:ring-ring size-3.5 rounded-[4px] outline-none transition-transform duration-100 hover:scale-125 focus-visible:scale-125 focus-visible:ring-2',
                          cellCls[st] ?? cellCls['-'],
                        )}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="text-muted-foreground flex items-center justify-between gap-3 border-t px-4 pt-2.5 pb-1 text-xs sm:px-5">
            <span>
              {expanded ? t('heat.allTitle', { n: sorted.length }) : t('heat.problemsTitle', { n: problems.length })}
            </span>
            {sorted.length > problems.length && (
              <Button size="sm" variant="ghost" className="text-muted-foreground -mr-2 h-7" onClick={() => onChange({ expanded: !expanded })} aria-expanded={expanded}>
                {expanded ? t('heat.showFewer') : t('heat.showAll', { n: sorted.length })}
              </Button>
            )}
          </div>
          <div className="scrollbar-thin overflow-x-auto px-3 pb-3 sm:px-4">
            <div className="min-w-[30rem] sm:min-w-0">
              {shown.length === 0 ? (
                <p className="text-muted-foreground py-3 text-center text-sm">{t('heat.noProblems')}</p>
              ) : (
                sections.map((s) => (
                  <div key={s.key} className={grouped ? 'mb-1' : undefined}>
                    {grouped && (
                      <div className="text-muted-foreground bg-card sticky left-0 flex items-center gap-2 px-1 pt-2 pb-1 text-xs">
                        <span className="text-foreground truncate font-semibold">{s.name}</span>
                        <span className="num">{s.items.length}</span>
                      </div>
                    )}
                    {s.items.map((it) => (
                      <Row
                        key={it.id}
                        item={it}
                        dot={dots.get(it.id) ?? statusDot.unknown}
                        activeK={tip && tip.id === it.id ? tip.k : -1}
                        label={t('heat.row', { name: it.name, uptime: it.uptime === null ? '—' : formatUptime(it.uptime, 2) })}
                        onHover={place}
                        onLeave={leave}
                        onOpen={onOpen}
                        onKey={keyNav}
                        onFocusRow={focusRow}
                      />
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {tipText && tip && (
        <div
          role="tooltip"
          className="bg-popover text-popover-foreground shadow-pop pointer-events-none fixed z-50 max-w-[16rem] rounded-lg border px-2.5 py-1.5 text-xs leading-snug"
          style={{ left: tip.x, top: tip.y - 8, transform: 'translate(-50%, -100%)' }}
        >
          {tipText}
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {tipText}
      </span>
    </Card>
  )
}
