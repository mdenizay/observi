import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowDown, ArrowUpDown, ChevronRight, LayoutGrid, List, Plus, Search, X, type LucideIcon } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { HeartbeatBar } from '@/components/heartbeat-bar'
import { KpiTile } from '@/components/kpi-tile'
import { PageHeader } from '@/components/app-shell'
import { Panel } from '@/components/panel'
import { MonitorDetail } from '@/components/monitor-detail'
import { Sparkline } from '@/components/sparkline'
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

const tileTone: Record<Eff, string> = { up: '', down: 'text-down', pending: 'text-pending', paused: '' }

function readView(): View {
  try {
    return localStorage.getItem('observi-dashboard-view') === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

/* ---------------------------------------------------------------- KPI tiles */

function StatusTiles({
  monitors,
  counts,
  filter,
  onToggle,
}: {
  monitors: MonitorSummary[] | undefined
  counts: Record<Eff, number>
  filter: Eff | null
  onToggle: (s: Eff) => void
}) {
  const { t } = useI18n()
  const order: Eff[] = ['up', 'down', 'pending', 'paused']
  const avgUp = useMemo(() => {
    const l = (monitors ?? [])
      .filter((m) => effectiveStatus(m) === 'up' && m.latency_ms !== null)
      .map((m) => m.latency_ms as number)
    return l.length ? l.reduce((a, b) => a + b, 0) / l.length : null
  }, [monitors])
  const total = monitors?.length ?? 0

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
      {order.map((s) => (
        <KpiTile
          key={s}
          as="button"
          active={filter === s}
          onClick={() => onToggle(s)}
          label={
            <span className="flex items-center gap-2">
              <span className={cn('size-2 shrink-0 rounded-full', statusDot[s])} />
              {t(`status.${s}` as const)}
            </span>
          }
          value={
            monitors ? (
              <span className={cn(counts[s] > 0 && tileTone[s])}>{counts[s]}</span>
            ) : (
              <Skeleton className="h-8 w-10" />
            )
          }
          sub={
            s === 'up' && avgUp !== null
              ? t('dash.avgShort', { latency: formatLatency(avgUp) })
              : t('dash.ofTotal', { total: formatNumber(total) })
          }
        />
      ))}
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
        'bg-card shadow-card focus-visible:ring-ring/40 hover:bg-accent/30 flex min-w-0 flex-col gap-3.5 rounded-2xl border p-4 text-left transition-[background-color,box-shadow] duration-150 outline-none focus-visible:ring-[3px] sm:p-5',
        status === 'down' && 'bg-down/[0.06] ring-down/30 hover:bg-down/[0.09] ring-1',
        paused && 'opacity-60 hover:opacity-90',
        selected && 'ring-foreground/40 ring-2',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium">{m.name}</div>
          <div className="text-muted-foreground mt-0.5 truncate text-xs">{monitorTarget(m) || '—'}</div>
        </div>
        <StatusBadge status={status} className="shrink-0" />
      </div>
      <HeartbeatBar beats={m.beats} max={40} size="sm" stretch />
      <div className="text-muted-foreground flex items-center gap-4 text-xs whitespace-nowrap">
        <span className="num text-foreground font-medium">{paused ? '—' : formatLatency(m.latency_ms)}</span>
        <span className="num">{t('card.uptime', { value: formatUptime(m.uptime_24h, 1) })}</span>
        <span className="ml-auto truncate">{m.last_check ? formatRelative(m.last_check, now) : t('dash.noChecks')}</span>
      </div>
    </button>
  )
})

function SkeletonCard() {
  return (
    <div className="bg-card flex flex-col gap-3.5 rounded-2xl border p-5">
      <div className="flex items-center gap-2">
        <Skeleton className="size-2 rounded-full" />
        <Skeleton className="h-4 flex-1" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="h-3 w-2/3" />
      <div className="flex justify-between">
        {Array.from({ length: 28 }, (_, i) => (
          <span key={i} className="bg-bar-empty h-[22px] w-1 animate-pulse rounded-full" />
        ))}
      </div>
      <Skeleton className="h-4 w-full" />
    </div>
  )
}

/* ---------------------------------------------------------------- list view */

// name | status | history | sparkline | response | uptime | last check | chevron
const rowGrid =
  'grid grid-cols-[minmax(0,1fr)_5.5rem_1rem] md:grid-cols-[minmax(0,1.3fr)_6.5rem_minmax(0,1fr)_5.5rem_5rem_1rem] xl:grid-cols-[minmax(0,1.3fr)_6.5rem_minmax(0,1fr)_6rem_5.5rem_5rem_7rem_1rem] items-center gap-4'

function SortHead({
  label,
  active,
  onClick,
  align,
  className,
}: {
  label: string
  active: boolean
  onClick?: () => void
  align?: 'right'
  className?: string
}) {
  const { t } = useI18n()
  if (!onClick)
    return <span className={cn('text-muted-foreground truncate text-xs', align === 'right' && 'text-right', className)}>{label}</span>
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('sort.by', { col: label })}
      className={cn(
        'text-muted-foreground hover:text-foreground focus-visible:text-foreground flex items-center gap-1 text-xs outline-none',
        align === 'right' && 'justify-end',
        active && 'text-foreground',
        className,
      )}
    >
      <span className="truncate">{label}</span>
      {active ? <ArrowDown className="size-3 shrink-0" /> : <ArrowUpDown className="size-3 shrink-0 opacity-50" />}
    </button>
  )
}

function ListHeader({ sort, onSort }: { sort: Sort; onSort: (s: Sort) => void }) {
  const { t } = useI18n()
  return (
    <div className={cn(rowGrid, 'bg-card/95 sticky top-14 z-10 border-b px-5 py-3 backdrop-blur lg:top-0')}>
      <SortHead label={t('col.monitor')} active={sort === 'name'} onClick={() => onSort('name')} />
      <SortHead label={t('col.status')} active={sort === 'status'} onClick={() => onSort('status')} className="hidden md:flex" />
      <SortHead label={t('col.history')} active={false} className="hidden md:block" />
      <span className="hidden xl:block" />
      <SortHead label={t('col.latency')} active={sort === 'slowest'} onClick={() => onSort('slowest')} align="right" />
      <SortHead label={t('col.uptime')} active={false} align="right" className="hidden md:block" />
      <SortHead label={t('col.lastCheck')} active={false} align="right" className="hidden xl:block" />
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
        'hover:bg-accent/40 focus-visible:bg-accent/50 w-full border-b px-5 py-3.5 text-left transition-colors duration-150 outline-none last:rounded-b-2xl last:border-b-0',
        status === 'down' && 'bg-down/[0.05] hover:bg-down/[0.08]',
        paused && 'text-muted-foreground',
        selected && 'bg-accent/60',
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn('size-2 shrink-0 rounded-full', statusDot[status])} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{m.name}</div>
          <div className="text-muted-foreground truncate text-xs">{monitorTarget(m) || '—'}</div>
        </div>
      </div>
      <div className="hidden md:block">
        <StatusBadge status={status} />
      </div>
      <div className="hidden min-w-0 md:block">
        <HeartbeatBar beats={m.beats} max={30} size="xs" stretch />
      </div>
      <div className="hidden xl:block">
        <Sparkline beats={m.beats.slice(-30)} width={96} height={22} />
      </div>
      <span className="num truncate text-right text-[13px]">{paused ? '—' : formatLatency(m.latency_ms)}</span>
      <span className="num text-muted-foreground hidden truncate text-right text-[13px] md:block">
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
  const [sort, setSort] = useState<Sort>('status')
  const [view, setViewState] = useState<View>(readView)
  const [collapsed, toggleCollapsed] = useCollapsedGroups()
  const narrowing = q.trim() !== '' || filter !== null

  const setView = (v: View) => {
    setViewState(v)
    try {
      localStorage.setItem('observi-dashboard-view', v)
    } catch {
      /* storage unavailable */
    }
  }

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
      <>
        <ListHeader sort={sort} onSort={setSort} />
        {list.map((m) => (
          <MonitorRow key={m.id} m={m} selected={m.id === selectedId} now={now} onOpen={openMonitor} />
        ))}
      </>
    )

  const viewBtn = (v: View, Icon: LucideIcon, label: string) => (
    <button
      type="button"
      onClick={() => setView(v)}
      aria-pressed={view === v}
      aria-label={label}
      title={label}
      className={cn(
        'text-muted-foreground hover:text-foreground flex h-7 w-9 items-center justify-center rounded-full transition-colors',
        view === v && 'bg-card text-foreground shadow-xs dark:bg-accent',
      )}
    >
      <Icon className="size-4" />
    </button>
  )

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <PageHeader
        title={t('nav.dashboard')}
        actions={
          isAdmin && (
            <Button asChild>
              <Link to="/monitors/new">
                <Plus />
                {t('nav.newMonitor')}
              </Link>
            </Button>
          )
        }
      />
      <StatusTiles monitors={monitors} counts={counts} filter={filter} onToggle={toggleFilter} />

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
        <div className="flex flex-1 items-center justify-end gap-2">
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">{t('dash.sort')}</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="border-input bg-card dark:bg-input/20 focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-xl border px-3 text-sm outline-none focus-visible:ring-[3px]"
            >
              <option value="status">{t('dash.sortStatus')}</option>
              <option value="name">{t('dash.sortName')}</option>
              <option value="slowest">{t('dash.sortSlowest')}</option>
            </select>
          </label>
          <div className="bg-muted flex rounded-full p-1" role="group" aria-label={t('view.label')}>
            {viewBtn('grid', LayoutGrid, t('view.grid'))}
            {viewBtn('list', List, t('view.list'))}
          </div>
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
            const header = (
              <button
                type="button"
                onClick={() => toggleCollapsed(g.key)}
                aria-expanded={!isCollapsed}
                className="hover:text-foreground focus-visible:ring-ring/40 flex min-w-0 items-center gap-2 rounded-md text-sm font-medium outline-none focus-visible:ring-2"
              >
                <ChevronRight className={cn('size-3.5 shrink-0 transition-transform duration-150', !isCollapsed && 'rotate-90')} />
                <span className={cn('size-1.5 shrink-0 rounded-full', groupDot(totals.all))} />
                <span className="text-foreground truncate">{g.name}</span>
                <span className="text-muted-foreground num font-normal">{formatNumber(totals.total)}</span>
              </button>
            )
            const upLabel = (
              <span className="text-muted-foreground num text-xs">{t('dash.groupUp', { up: totals.up, total: totals.total })}</span>
            )
            return view === 'list' ? (
              <Panel key={g.key} title={header} actions={upLabel}>
                {!isCollapsed && renderMonitors(g.monitors)}
              </Panel>
            ) : (
              <section key={g.key}>
                <div className="mb-3 flex items-center justify-between gap-3 px-1">
                  {header}
                  {upLabel}
                </div>
                {!isCollapsed && renderMonitors(g.monitors)}
              </section>
            )
          })
        : filtered.length > 0 &&
          (view === 'list' ? (
            <Panel title={t('dash.monitorsTitle')} actions={<span className="text-muted-foreground num pr-1 text-xs">{formatNumber(filtered.length)}</span>}>
              {renderMonitors(filtered)}
            </Panel>
          ) : (
            renderMonitors(filtered)
          ))}

      {/* Detail drawer (route-driven) */}
      <Sheet open={selected !== undefined} onOpenChange={(o) => !o && closeDrawer()}>
        <SheetContent side="right" className="bg-background w-full max-w-none gap-0 p-0 sm:max-w-xl 2xl:max-w-2xl">
          <SheetTitle className="sr-only">{t('dash.drawerTitle')}</SheetTitle>
          <SheetDescription className="sr-only">{t('dash.drawerDesc')}</SheetDescription>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            {drawerMonitor && <MonitorDetail key={drawerMonitor.id} monitor={drawerMonitor} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
