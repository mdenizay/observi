import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  ChevronRight,
  Clock,
  LayoutGrid,
  List,
  Lock,
  PauseCircle,
  Plus,
  Search,
  ShieldAlert,
  X,
  type LucideIcon,
} from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { HeartbeatBar } from '@/components/heartbeat-bar'
import { MonitorDetail } from '@/components/monitor-detail'
import { Sparkline } from '@/components/sparkline'
import { SslBadge } from '@/components/ssl-badge'
import { sslIsBad, sslNeedsAttention } from '@/lib/cert'
import { StatusBadge, statusDot } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useIsAdmin } from '@/hooks/use-auth'
import { useMonitors } from '@/hooks/use-monitors'
import { useNow } from '@/hooks/use-now'
import { DASHBOARD_SEARCH_ID } from '@/hooks/use-shortcuts'
import { useI18n } from '@/i18n'
import { formatLatency, formatNumber, formatRelative, formatUptime, monitorTarget } from '@/lib/format'
import type { MonitorSummary } from '@/lib/types'
import { cn } from '@/lib/utils'

type Eff = 'up' | 'down' | 'pending' | 'paused'
type Sort = 'status' | 'name' | 'slowest'
type View = 'grid' | 'list'

function effectiveStatus(m: MonitorSummary): Eff {
  if (!m.active) return 'paused'
  if (m.status === 'up' || m.status === 'down' || m.status === 'paused') return m.status
  return 'pending' // pending + unknown
}

const statusOrder: Record<Eff, number> = { down: 0, pending: 1, up: 2, paused: 3 }

const tileStyle: Record<Eff, { icon: LucideIcon; text: string; active: string }> = {
  up: { icon: ArrowUpCircle, text: 'text-up', active: 'border-up/45 bg-up/[0.06] ring-up/25' },
  down: { icon: ArrowDownCircle, text: 'text-down', active: 'border-down/45 bg-down/[0.06] ring-down/25' },
  pending: { icon: Clock, text: 'text-pending', active: 'border-pending/45 bg-pending/[0.06] ring-pending/25' },
  paused: { icon: PauseCircle, text: 'text-paused', active: 'border-paused/45 bg-paused/[0.06] ring-paused/25' },
}

function readView(): View {
  try {
    return localStorage.getItem('observi-dashboard-view') === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

/* ---------------------------------------------------------------- hero + tiles */

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
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
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
              'bg-card shadow-card hover:border-border-strong focus-visible:ring-ring/50 flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left transition-[border-color,background-color,box-shadow] duration-150 outline-none focus-visible:ring-[3px]',
              active && cn('ring-2', st.active),
            )}
          >
            <div className="min-w-0">
              <div className="text-muted-foreground flex items-center gap-1.5 truncate text-xs font-medium">
                <span className={cn('size-1.5 shrink-0 rounded-full', statusDot[s])} />
                {t(`status.${s}` as const)}
              </div>
              <div className={cn('num mt-1 text-2xl font-semibold', counts[s] > 0 ? st.text : 'text-foreground/70')}>
                {loaded ? counts[s] : <Skeleton className="h-8 w-10" />}
              </div>
            </div>
            <st.icon className={cn('size-5 shrink-0', active ? st.text : 'text-muted-foreground/50')} />
          </button>
        )
      })}
    </div>
  )
}

/* ---------------------------------------------------------------- grid card */

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
        'bg-card shadow-card focus-visible:ring-ring/50 hover:shadow-raised hover:border-border-strong flex min-w-0 flex-col gap-3 rounded-xl border p-4 text-left transition-[border-color,box-shadow,background-color] duration-150 outline-none focus-visible:ring-[3px]',
        status === 'down' && 'border-down/40 bg-down/[0.045] hover:border-down/60',
        paused && 'opacity-60 hover:opacity-90',
        selected && 'ring-primary/50 border-primary/50 ring-2',
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className={cn('size-2 shrink-0 rounded-full', statusDot[status])} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{m.name}</span>
        <SslBadge monitor={m} className="max-w-[7.5rem]" />
        <StatusBadge status={status} className="shrink-0" />
      </div>
      <div className="text-muted-foreground -mt-1.5 h-4 truncate text-xs leading-4">{monitorTarget(m) || '—'}</div>
      <HeartbeatBar beats={m.beats} max={40} size="sm" stretch />
      <div className="text-muted-foreground grid grid-cols-[1fr_1fr_1.5fr] gap-2 border-t pt-2.5 text-xs whitespace-nowrap">
        <span className="num text-foreground truncate font-medium" title={t('detail.latencyNow')}>
          {paused ? '—' : formatLatency(m.latency_ms)}
        </span>
        <span className="num truncate" title={`${t('detail.uptime')} · ${t('range.24h')}`}>
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
    <div className="bg-card flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-center gap-2">
        <Skeleton className="size-2 rounded-full" />
        <Skeleton className="h-4 flex-1" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-3 w-full" />
    </div>
  )
}

/* ---------------------------------------------------------------- list view */

// name | history | sparkline | latency | uptime | last check | chevron
const rowGrid =
  'grid grid-cols-[minmax(0,1fr)_5.5rem_1rem] md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_5.5rem_5rem_1rem] xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_6rem_5.5rem_5rem_7rem_1rem] items-center gap-4'

function ListHeader() {
  const { t } = useI18n()
  return (
    <div
      className={cn(
        rowGrid,
        'bg-card/95 text-muted-foreground sticky top-14 z-10 rounded-t-xl border-b px-4 py-2 text-xs font-medium backdrop-blur',
      )}
    >
      <span>{t('col.monitor')}</span>
      <span className="hidden md:block">{t('col.history')}</span>
      <span className="hidden xl:block" />
      <span className="text-right">{t('col.latency')}</span>
      <span className="hidden text-right md:block">{t('col.uptime')}</span>
      <span className="hidden text-right xl:block">{t('col.lastCheck')}</span>
      <span />
    </div>
  )
}

const MonitorRow = memo(function MonitorRow({
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
        rowGrid,
        'hover:bg-accent/50 focus-visible:bg-accent/60 w-full border-b px-4 py-2.5 text-left transition-colors duration-150 outline-none last:rounded-b-xl last:border-b-0',
        status === 'down' && 'bg-down/[0.045] hover:bg-down/[0.08]',
        paused && 'text-muted-foreground',
        selected && 'bg-primary/[0.07] hover:bg-primary/10',
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn('size-2 shrink-0 rounded-full', statusDot[status])} title={t(`status.${status}` as const)} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{m.name}</span>
            <SslBadge monitor={m} className="max-w-[7rem]" />
          </div>
          <div className="text-muted-foreground truncate text-xs">{monitorTarget(m) || '—'}</div>
        </div>
      </div>
      <div className="hidden min-w-0 md:block">
        <HeartbeatBar beats={m.beats} max={30} size="xs" stretch />
      </div>
      <div className="hidden xl:block">
        <Sparkline beats={m.beats.slice(-30)} width={96} height={22} />
      </div>
      <span className="num truncate text-right text-sm">{paused ? '—' : formatLatency(m.latency_ms)}</span>
      <span className="num text-muted-foreground hidden truncate text-right text-sm md:block">
        {formatUptime(m.uptime_24h, 1)}
      </span>
      <span className="text-muted-foreground hidden truncate text-right text-xs xl:block">
        {m.last_check ? formatRelative(m.last_check, now) : t('dash.noChecks')}
      </span>
      <ChevronRight className="text-muted-foreground/60 size-4" />
    </button>
  )
})

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

const gridCls = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,17.5rem),1fr))] gap-3'

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
  const [sslOnly, setSslOnly] = useState(false)
  const [sort, setSort] = useState<Sort>('status')
  const [view, setViewState] = useState<View>(readView)
  const [collapsed, toggleCollapsed] = useCollapsedGroups()
  const narrowing = q.trim() !== '' || filter !== null || sslOnly

  const setView = (v: View) => {
    setViewState(v)
    try {
      localStorage.setItem('observi-dashboard-view', v)
    } catch {
      /* storage unavailable */
    }
  }

  const sslCount = useMemo(() => (monitors ?? []).filter(sslNeedsAttention).length, [monitors])
  const sslExpired = useMemo(() => (monitors ?? []).some(sslIsBad), [monitors])

  const counts = useMemo(() => {
    const c: Record<Eff, number> = { up: 0, down: 0, pending: 0, paused: 0 }
    for (const m of monitors ?? []) c[effectiveStatus(m)]++
    return c
  }, [monitors])

  // Group totals are over ALL monitors of the group, regardless of filters.
  const groupTotals = useMemo(() => {
    const map = new Map<string, { up: number; total: number; all: MonitorSummary[] }>()
    for (const m of monitors ?? []) {
      const key = m.group_id === null ? 'none' : String(m.group_id)
      const g = map.get(key) ?? { up: 0, total: 0, all: [] }
      g.total++
      if (effectiveStatus(m) === 'up') g.up++
      g.all.push(m)
      map.set(key, g)
    }
    return map
  }, [monitors])

  const filtered = useMemo(() => {
    const term = q.trim().toLocaleLowerCase(lang)
    const byName = (a: MonitorSummary, b: MonitorSummary) => a.name.localeCompare(b.name, lang)
    return (monitors ?? [])
      .filter((m) => filter === null || effectiveStatus(m) === filter)
      .filter((m) => !sslOnly || sslNeedsAttention(m))
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
  }, [monitors, q, filter, sslOnly, sort, lang])

  // null = no groups at all → flat layout without headers.
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
    setSslOnly(false)
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

  const renderMonitors = (list: MonitorSummary[]) =>
    view === 'grid' ? (
      <div className={gridCls}>
        {list.map((m) => (
          <MonitorCard key={m.id} m={m} selected={m.id === selectedId} now={now} onOpen={openMonitor} />
        ))}
      </div>
    ) : (
      <div className="bg-card shadow-card rounded-xl border">
        <ListHeader />
        {list.map((m) => (
          <MonitorRow key={m.id} m={m} selected={m.id === selectedId} now={now} onOpen={openMonitor} />
        ))}
      </div>
    )

  const viewBtn = (v: View, Icon: LucideIcon, label: string) => (
    <button
      type="button"
      onClick={() => setView(v)}
      aria-pressed={view === v}
      aria-label={label}
      title={label}
      className={cn(
        'text-muted-foreground hover:text-foreground flex h-7 w-8 items-center justify-center rounded-md transition-colors',
        view === v && 'bg-card text-foreground shadow-xs',
      )}
    >
      <Icon className="size-4" />
    </button>
  )

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <StatusTiles counts={counts} loaded={!!monitors} filter={filter} onToggle={toggleFilter} />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-full sm:basis-auto sm:max-w-sm">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            id={DASHBOARD_SEARCH_ID}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (setQ(''), e.currentTarget.blur())}
            placeholder={t('dash.search')}
            className="pr-9 pl-9"
          />
          {q ? (
            <button
              onClick={() => setQ('')}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
              aria-label={t('dash.clearSearch')}
            >
              <X className="size-4" />
            </button>
          ) : (
            <Kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 sm:inline-flex">/</Kbd>
          )}
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          {(sslCount > 0 || sslOnly) && (
            <button
              type="button"
              aria-pressed={sslOnly}
              onClick={() => setSslOnly((v) => !v)}
              title={t('ssl.filterTip')}
              className={cn(
                'num focus-visible:ring-ring/50 inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px]',
                sslExpired ? 'border-down/30 bg-down/10 text-down' : 'border-pending/35 bg-pending/12 text-pending',
                sslOnly && (sslExpired ? 'ring-down/50 ring-2' : 'ring-pending/60 ring-2'),
              )}
            >
              {sslExpired ? <ShieldAlert className="size-3.5" /> : <Lock className="size-3.5" />}
              {t('ssl.filter', { count: sslCount })}
            </button>
          )}
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">{t('dash.sort')}</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="border-input bg-card dark:bg-input/20 focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-lg border px-2.5 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
            >
              <option value="status">{t('dash.sortStatus')}</option>
              <option value="name">{t('dash.sortName')}</option>
              <option value="slowest">{t('dash.sortSlowest')}</option>
            </select>
          </label>
          <div className="bg-muted flex rounded-lg border p-0.5" role="group" aria-label={t('view.label')}>
            {viewBtn('grid', LayoutGrid, t('view.grid'))}
            {viewBtn('list', List, t('view.list'))}
          </div>
          {isAdmin && (
            <Button asChild className="max-sm:size-9 max-sm:px-0">
              <Link to="/monitors/new" aria-label={t('nav.newMonitor')}>
                <Plus />
                <span className="max-sm:sr-only">{t('nav.newMonitor')}</span>
              </Link>
            </Button>
          )}
        </div>
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
        <Card className="py-0">
          {monitors.length === 0 ? (
            <EmptyState
              kind="monitors"
              title={isAdmin ? t('dash.emptyAdmin') : t('dash.emptyUser')}
              action={
                isAdmin && (
                  <Button asChild size="sm">
                    <Link to="/monitors/new">
                      <Plus />
                      {t('nav.newMonitor')}
                    </Link>
                  </Button>
                )
              }
            />
          ) : (
            <EmptyState
              kind="search"
              title={t('common.noResults')}
              action={
                narrowing && (
                  <Button size="sm" variant="outline" onClick={clearFilters}>
                    {t('dash.clearFilters')}
                  </Button>
                )
              }
            />
          )}
        </Card>
      )}
      {grouped
        ? grouped.map((g) => {
            const isCollapsed = !narrowing && collapsed.has(g.key)
            const totals = groupTotals.get(g.key) ?? { up: 0, total: g.monitors.length, all: g.monitors }
            return (
              <section key={g.key}>
                <button
                  type="button"
                  onClick={() => toggleCollapsed(g.key)}
                  aria-expanded={!isCollapsed}
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 mb-2.5 flex w-full items-center gap-2.5 rounded-md py-1 text-xs outline-none focus-visible:ring-[3px]"
                >
                  <ChevronRight className={cn('size-3.5 shrink-0 transition-transform duration-150', !isCollapsed && 'rotate-90')} />
                  <span className={cn('size-2 shrink-0 rounded-full', groupDot(totals.all))} />
                  <span className="text-foreground truncate text-sm font-semibold">{g.name}</span>
                  <span className="num">{formatNumber(totals.total)}</span>
                  <span className="bg-border h-px flex-1" />
                  <span className="num whitespace-nowrap">{t('dash.groupUp', { up: totals.up, total: totals.total })}</span>
                </button>
                {!isCollapsed && renderMonitors(g.monitors)}
              </section>
            )
          })
        : filtered.length > 0 && renderMonitors(filtered)}

      {/* Detail drawer (route-driven) */}
      <Sheet open={selected !== undefined} onOpenChange={(o) => !o && closeDrawer()}>
        <SheetContent side="right" className="bg-background w-full max-w-none gap-0 p-0 sm:max-w-xl 2xl:max-w-2xl">
          <SheetTitle className="sr-only">{t('dash.drawerTitle')}</SheetTitle>
          <SheetDescription className="sr-only">{t('dash.drawerDesc')}</SheetDescription>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            {drawerMonitor && <MonitorDetail key={drawerMonitor.id} monitor={drawerMonitor} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
