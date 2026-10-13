import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock,
  Hourglass,
  PauseCircle,
  Plus,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react'
import { HeartbeatBar } from '@/components/heartbeat-bar'
import { MonitorDetail } from '@/components/monitor-detail'
import { StatusBadge, statusDot } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useIsAdmin } from '@/hooks/use-auth'
import { useMonitors } from '@/hooks/use-monitors'
import { useNow } from '@/hooks/use-now'
import { useI18n } from '@/i18n'
import { formatLatency, formatNumber, formatRelative, formatUptime, monitorTarget } from '@/lib/format'
import type { MonitorSummary } from '@/lib/types'
import { cn } from '@/lib/utils'

type Eff = 'up' | 'down' | 'pending' | 'paused'
type Sort = 'status' | 'name' | 'slowest'

function effectiveStatus(m: MonitorSummary): Eff {
  if (!m.active) return 'paused'
  if (m.status === 'up' || m.status === 'down' || m.status === 'paused') return m.status
  return 'pending' // pending + unknown
}

const statusOrder: Record<Eff, number> = { down: 0, pending: 1, up: 2, paused: 3 }

const tileStyle: Record<Eff, { icon: LucideIcon; text: string; active: string }> = {
  up: { icon: ArrowUpCircle, text: 'text-up', active: 'border-up/50 bg-up/5 ring-up/30' },
  down: { icon: ArrowDownCircle, text: 'text-down', active: 'border-down/50 bg-down/5 ring-down/30' },
  pending: { icon: Clock, text: 'text-pending', active: 'border-pending/50 bg-pending/5 ring-pending/30' },
  paused: { icon: PauseCircle, text: 'text-paused', active: 'border-paused/50 bg-paused/5 ring-paused/30' },
}

/* ---------------------------------------------------------------- hero + tiles */

function Hero({
  monitors,
  counts,
  isAdmin,
}: {
  monitors: MonitorSummary[] | undefined
  counts: Record<Eff, number>
  isAdmin: boolean
}) {
  const { t } = useI18n()

  const stats = useMemo(() => {
    const active = (monitors ?? []).filter((m) => m.active)
    const lat = active.map((m) => m.latency_ms).filter((v): v is number => v !== null)
    const upt = active.map((m) => m.uptime_24h).filter((v): v is number => v !== null)
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
    return { latency: avg(lat), uptime: avg(upt) }
  }, [monitors])

  const total = monitors?.length ?? 0
  let tone: 'up' | 'down' | 'pending' | 'muted' = 'up'
  let title = ''
  let Icon: LucideIcon = CheckCircle2
  if (!monitors) {
    tone = 'muted'
  } else if (total === 0) {
    tone = 'muted'
    title = t('dash.heroEmpty')
    Icon = Hourglass
  } else if (counts.down > 0) {
    tone = 'down'
    title = t('dash.nDown', { count: counts.down })
    Icon = CircleAlert
  } else if (counts.pending > 0) {
    tone = 'pending'
    title = t('dash.nPending', { count: counts.pending })
    Icon = Hourglass
  } else if (counts.up === 0) {
    tone = 'muted'
    title = t('dash.allPaused')
    Icon = PauseCircle
  } else {
    title = t('dash.allOperational')
  }

  const toneCls = {
    up: 'bg-up/12 text-up',
    down: 'bg-down/12 text-down',
    pending: 'bg-pending/12 text-pending',
    muted: 'bg-muted text-muted-foreground',
  }[tone]

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3.5">
        <div className={cn('flex size-12 shrink-0 items-center justify-center rounded-2xl', toneCls)}>
          <Icon className="size-6" />
        </div>
        <div className="min-w-0">
          {monitors ? (
            <>
              <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
              {total > 0 && (
                <p className="text-muted-foreground mt-0.5 text-sm tabular-nums">
                  {t('dash.heroSub', {
                    count: total,
                    latency: stats.latency === null ? '—' : formatLatency(stats.latency),
                    uptime: stats.uptime === null ? '—' : formatUptime(stats.uptime, 2),
                  })}
                </p>
              )}
            </>
          ) : (
            <>
              <Skeleton className="h-7 w-56" />
              <Skeleton className="mt-2 h-4 w-72" />
            </>
          )}
        </div>
      </div>
      {isAdmin && (
        <Button asChild className="shrink-0 max-sm:size-9 max-sm:px-0">
          <Link to="/monitors/new" aria-label={t('dash.add')}>
            <Plus />
            <span className="max-sm:sr-only">{t('dash.add')}</span>
          </Link>
        </Button>
      )}
    </div>
  )
}

function StatusTiles({
  counts,
  loaded,
  filter,
  onToggle,
}: {
  counts: Record<Eff, number>
  loaded: boolean
  filter: Eff | null
  onToggle: (s: Eff) => void
}) {
  const { t } = useI18n()
  const order: Eff[] = ['up', 'down', 'pending', 'paused']
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {order.map((s) => {
        const st = tileStyle[s]
        const active = filter === s
        return (
          <button
            key={s}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(s)}
            className={cn(
              'bg-card hover:border-foreground/25 focus-visible:ring-ring/50 flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left shadow-xs transition-colors outline-none focus-visible:ring-[3px]',
              active && cn('ring-2', st.active),
            )}
          >
            <div className="min-w-0">
              <div className="text-muted-foreground flex items-center gap-1.5 truncate text-xs font-medium">
                <span className={cn('size-1.5 shrink-0 rounded-full', statusDot[s])} />
                {t(`status.${s}` as const)}
              </div>
              <div className={cn('mt-0.5 text-2xl font-semibold tabular-nums', counts[s] > 0 && st.text)}>
                {loaded ? counts[s] : <Skeleton className="h-8 w-10" />}
              </div>
            </div>
            <st.icon className={cn('size-5 shrink-0 opacity-70', st.text)} />
          </button>
        )
      })}
    </div>
  )
}

/* ---------------------------------------------------------------- card */

const MonitorCard = memo(function MonitorCard({
  m,
  selected,
  now,
  onOpen,
}: {
  m: MonitorSummary
  selected: boolean
  now: number
  onOpen: (id: number) => void
}) {
  const { t } = useI18n()
  const status = effectiveStatus(m)
  const paused = status === 'paused'
  return (
    <button
      type="button"
      onClick={() => onOpen(m.id)}
      aria-pressed={selected}
      className={cn(
        'bg-card focus-visible:ring-ring/50 hover:border-foreground/25 relative flex min-w-0 flex-col gap-2.5 overflow-hidden rounded-xl border p-3.5 text-left shadow-xs transition-[border-color,box-shadow] outline-none hover:shadow-md focus-visible:ring-[3px]',
        status === 'down' && 'bg-down/[0.05] border-down/35 hover:border-down/60',
        paused && 'opacity-65',
        selected && 'border-primary/60 ring-primary/40 ring-2',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn('size-2 shrink-0 rounded-full', statusDot[status], status === 'down' && 'animate-pulse')}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{m.name}</span>
        <StatusBadge status={status} className="shrink-0" />
      </div>
      <div className="text-muted-foreground -mt-1 h-4 truncate text-xs leading-4">{monitorTarget(m) || '—'}</div>
      <HeartbeatBar beats={m.beats} max={40} size="sm" stretch />
      <div className="text-muted-foreground grid grid-cols-[1fr_1fr_1.5fr] gap-2 text-xs whitespace-nowrap tabular-nums">
        <span className="text-foreground truncate font-medium" title={t('detail.latencyNow')}>
          {paused ? '—' : formatLatency(m.latency_ms)}
        </span>
        <span className="truncate" title={`${t('detail.uptime')} · ${t('range.24h')}`}>
          {formatUptime(m.uptime_24h, 1)}
        </span>
        <span className="truncate text-right" title={t('detail.lastCheck')}>
          {m.last_check ? formatRelative(m.last_check, now) : t('dash.noChecks')}
        </span>
      </div>
    </button>
  )
})

function SkeletonCard() {
  return (
    <div className="bg-card flex flex-col gap-2.5 rounded-xl border p-3.5">
      <div className="flex items-center gap-2">
        <Skeleton className="size-2 rounded-full" />
        <Skeleton className="h-4 flex-1" />
        <Skeleton className="h-5 w-16" />
      </div>
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-3 w-full" />
    </div>
  )
}

/* ---------------------------------------------------------------- groups */

interface MonitorGroupView {
  key: string
  name: string
  monitors: MonitorSummary[]
}

const COLLAPSE_KEY = 'observi-collapsed-groups'

function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY)
    const arr: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? arr.map(String) : [])
  } catch {
    return new Set()
  }
}

function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed)
  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]))
      } catch {
        /* storage unavailable */
      }
      return next
    })
  }, [])
  return [collapsed, toggle] as const
}

function groupDot(monitors: MonitorSummary[]) {
  const st = monitors.map(effectiveStatus)
  if (st.includes('down')) return 'bg-down'
  if (st.includes('pending')) return 'bg-pending'
  if (st.every((s) => s === 'paused')) return 'bg-paused'
  return 'bg-up'
}

const gridCls = 'grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3'

/* ---------------------------------------------------------------- page */

export function DashboardPage() {
  const { t, lang } = useI18n()
  const { id } = useParams()
  const selectedId = id ? Number(id) : null
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()
  const { data: monitors, isPending, isError, refetch } = useMonitors()
  const now = useNow(30_000)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Eff | null>(null)
  const [sort, setSort] = useState<Sort>('status')
  const [collapsed, toggleCollapsed] = useCollapsedGroups()
  const narrowing = q.trim() !== '' || filter !== null

  const counts = useMemo(() => {
    const c: Record<Eff, number> = { up: 0, down: 0, pending: 0, paused: 0 }
    for (const m of monitors ?? []) c[effectiveStatus(m)]++
    return c
  }, [monitors])

  const filtered = useMemo(() => {
    const term = q.trim().toLocaleLowerCase(lang)
    const byName = (a: MonitorSummary, b: MonitorSummary) => a.name.localeCompare(b.name, lang)
    return (monitors ?? [])
      .filter((m) => filter === null || effectiveStatus(m) === filter)
      .filter(
        (m) =>
          !term ||
          m.name.toLocaleLowerCase(lang).includes(term) ||
          monitorTarget(m).toLocaleLowerCase(lang).includes(term),
      )
      .sort((a, b) => {
        if (sort === 'name') return byName(a, b)
        if (sort === 'slowest') {
          const la = a.active ? (a.latency_ms ?? -1) : -1
          const lb = b.active ? (b.latency_ms ?? -1) : -1
          return lb - la || byName(a, b)
        }
        return statusOrder[effectiveStatus(a)] - statusOrder[effectiveStatus(b)] || byName(a, b)
      })
  }, [monitors, q, filter, sort, lang])

  // Per-group totals over ALL monitors, so headers don't change with search/filters.
  const groupTotals = useMemo(() => {
    const totals = new Map<string, { up: number; total: number }>()
    for (const m of monitors ?? []) {
      const key = m.group_id === null ? 'none' : String(m.group_id)
      const e = totals.get(key) ?? { up: 0, total: 0 }
      e.total += 1
      if (effectiveStatus(m) === 'up') e.up += 1
      totals.set(key, e)
    }
    return totals
  }, [monitors])

  // null = no groups at all → flat grid without headers.
  const grouped = useMemo<MonitorGroupView[] | null>(() => {
    if (!monitors?.some((m) => m.group_id !== null)) return null
    const map = new Map<number, MonitorGroupView>()
    const ungrouped: MonitorSummary[] = []
    for (const m of filtered) {
      if (m.group_id === null) {
        ungrouped.push(m)
        continue
      }
      let g = map.get(m.group_id)
      if (!g) {
        g = { key: String(m.group_id), name: m.group_name || t('dash.groupFallback', { id: m.group_id }), monitors: [] }
        map.set(m.group_id, g)
      }
      g.monitors.push(m)
    }
    const list = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, lang))
    if (ungrouped.length) list.push({ key: 'none', name: t('dash.ungrouped'), monitors: ungrouped })
    return list
  }, [monitors, filtered, lang, t])

  const openMonitor = useCallback((mid: number) => navigate(`/dashboard/${mid}`), [navigate])
  const closeDrawer = useCallback(() => navigate('/dashboard'), [navigate])
  const toggleFilter = useCallback((s: Eff) => setFilter((f) => (f === s ? null : s)), [])
  const clearFilters = () => {
    setQ('')
    setFilter(null)
  }

  const selected = monitors?.find((m) => m.id === selectedId)
  // Keep the last shown monitor around so the drawer can animate out.
  const [last, setLast] = useState<MonitorSummary | undefined>(undefined)
  if (selected && selected !== last) setLast(selected)
  const drawerMonitor = selected ?? last

  // Unknown / inaccessible id → back to the grid.
  useEffect(() => {
    if (selectedId !== null && monitors && !selected) navigate('/dashboard', { replace: true })
  }, [selectedId, monitors, selected, navigate])

  const renderCards = (list: MonitorSummary[]) => (
    <div className={gridCls}>
      {list.map((m) => (
        <MonitorCard key={m.id} m={m} selected={m.id === selectedId} now={now} onOpen={openMonitor} />
      ))}
    </div>
  )

  return (
    <div className="flex flex-col gap-5">
      <Hero monitors={monitors} counts={counts} isAdmin={isAdmin} />
      <StatusTiles counts={counts} loaded={!!monitors} filter={filter} onToggle={toggleFilter} />

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('dash.search')}
            className="pr-8 pl-8"
          />
          {q && (
            <button
              onClick={() => setQ('')}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
              aria-label={t('dash.clearSearch')}
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <label className="flex items-center gap-2 sm:ml-auto">
          <span className="text-muted-foreground text-xs font-medium">{t('dash.sort')}</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-md border bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
          >
            <option value="status">{t('dash.sortStatus')}</option>
            <option value="name">{t('dash.sortName')}</option>
            <option value="slowest">{t('dash.sortSlowest')}</option>
          </select>
        </label>
      </div>

      {/* Monitors */}
      {isPending && (
        <div className={gridCls}>
          {Array.from({ length: 8 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}
      {isError && (
        <Card className="text-muted-foreground items-center gap-2 p-8 text-center text-sm">
          {t('dash.loadFailed')}
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            {t('common.retry')}
          </Button>
        </Card>
      )}
      {monitors && filtered.length === 0 && (
        <Card className="text-muted-foreground items-center gap-3 p-10 text-center text-sm">
          {monitors.length === 0 ? (
            isAdmin ? (
              <>
                {t('dash.emptyAdmin')}
                <Button asChild size="sm">
                  <Link to="/monitors/new">
                    <Plus />
                    {t('nav.newMonitor')}
                  </Link>
                </Button>
              </>
            ) : (
              t('dash.emptyUser')
            )
          ) : (
            <>
              {t('common.noResults')}
              {narrowing && (
                <Button size="sm" variant="outline" onClick={clearFilters}>
                  {t('dash.clearFilters')}
                </Button>
              )}
            </>
          )}
        </Card>
      )}
      {grouped
        ? grouped.map((g) => {
            const isCollapsed = !narrowing && collapsed.has(g.key)
            const totals = groupTotals.get(g.key) ?? { up: 0, total: g.monitors.length }
            return (
              <section key={g.key} className="-mb-1">
                <button
                  type="button"
                  onClick={() => toggleCollapsed(g.key)}
                  aria-expanded={!isCollapsed}
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 mb-2 flex w-full items-center gap-2 rounded-md px-1 py-1 text-xs font-semibold outline-none focus-visible:ring-[3px]"
                >
                  <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', !isCollapsed && 'rotate-90')} />
                  <span className={cn('size-2 shrink-0 rounded-full', groupDot(g.monitors))} />
                  <span className="text-foreground truncate text-sm">{g.name}</span>
                  <span className="tabular-nums">{formatNumber(totals.total)}</span>
                  <span className="bg-border h-px flex-1" />
                  <span className="font-normal whitespace-nowrap tabular-nums">
                    {t('dash.groupUp', { up: totals.up, total: totals.total })}
                  </span>
                </button>
                {!isCollapsed && <div className="mb-4">{renderCards(g.monitors)}</div>}
              </section>
            )
          })
        : filtered.length > 0 && renderCards(filtered)}

      {/* Detail drawer (route-driven) */}
      <Sheet open={selected !== undefined} onOpenChange={(o) => !o && closeDrawer()}>
        <SheetContent
          side="right"
          className="bg-background w-full max-w-none gap-0 p-0 sm:max-w-xl 2xl:max-w-2xl"
        >
          <div className="flex h-12 shrink-0 items-center border-b px-4">
            <SheetTitle className="text-sm font-semibold">{t('dash.drawerTitle')}</SheetTitle>
            <SheetDescription className="sr-only">{t('dash.drawerDesc')}</SheetDescription>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
            {drawerMonitor && <MonitorDetail key={drawerMonitor.id} monitor={drawerMonitor} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
