import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  ChevronRight,
  Clock,
  PauseCircle,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { HeartbeatBar } from '@/components/heartbeat-bar'
import { MonitorDetail } from '@/components/monitor-detail'
import { StatusBadge, UptimeBadge, statusDot } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useIsAdmin } from '@/hooks/use-auth'
import { useMonitors } from '@/hooks/use-monitors'
import { useNow } from '@/hooks/use-now'
import { formatLatency, formatRelative, monitorTarget } from '@/lib/format'
import type { MonitorSummary } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'

type Eff = 'up' | 'down' | 'pending' | 'paused'

function effectiveStatus(m: MonitorSummary): Eff {
  if (!m.active) return 'paused'
  if (m.status === 'up' || m.status === 'down' || m.status === 'paused') return m.status
  return 'pending' // pending + unknown
}

function SummaryCards({ monitors }: { monitors: MonitorSummary[] | undefined }) {
  const { t } = useI18n()
  const counts = useMemo(() => {
    const c = { up: 0, down: 0, pending: 0, paused: 0 }
    for (const m of monitors ?? []) c[effectiveStatus(m)]++
    return c
  }, [monitors])

  const items = [
    { label: t('status.up'), value: counts.up, icon: ArrowUpCircle, cls: 'text-up' },
    { label: t('status.down'), value: counts.down, icon: ArrowDownCircle, cls: 'text-down' },
    { label: t('status.pending'), value: counts.pending, icon: Clock, cls: 'text-pending' },
    { label: t('status.paused'), value: counts.paused, icon: PauseCircle, cls: 'text-paused' },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((it) => (
        <Card key={it.label} className="gap-1 px-4 py-3">
          <div className="text-muted-foreground flex items-center justify-between text-xs font-medium">
            {it.label}
            <it.icon className={cn('size-4', it.cls)} />
          </div>
          <div className={cn('text-2xl font-semibold tabular-nums', it.value > 0 && it.cls)}>
            {monitors ? it.value : <Skeleton className="h-8 w-10" />}
          </div>
        </Card>
      ))}
    </div>
  )
}

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
  return (
    <button
      type="button"
      onClick={() => onOpen(m.id)}
      aria-pressed={selected}
      className={cn(
        'bg-card hover:bg-accent/40 focus-visible:ring-ring/50 flex min-w-0 flex-col gap-2.5 rounded-xl border p-3.5 text-left shadow-xs transition-colors outline-none focus-visible:ring-[3px]',
        status === 'down' && 'border-down/40 bg-down/5 hover:bg-down/10',
        status === 'paused' && 'opacity-70',
        selected && 'ring-primary/60 ring-2',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn('size-2 shrink-0 rounded-full', statusDot[status], status === 'down' && 'animate-pulse')}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{m.name}</span>
        {status === 'up' ? <UptimeBadge value={m.uptime_24h} /> : <StatusBadge status={status} />}
      </div>
      <div className="text-muted-foreground -mt-1 truncate text-xs">{monitorTarget(m) || '—'}</div>
      <HeartbeatBar beats={m.beats} max={30} size="sm" />
      <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
        <span className="text-foreground font-medium tabular-nums">
          {status === 'paused' ? '—' : formatLatency(m.latency_ms)}
        </span>
        <span className="flex items-center gap-2 truncate">
          {status !== 'up' && m.uptime_24h !== null && <UptimeBadge value={m.uptime_24h} className="min-w-0" />}
          <span className="truncate">{m.last_check ? `${formatRelative(m.last_check, now)}` : t('dash.noChecks')}</span>
        </span>
      </div>
    </button>
  )
})

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

const gridCls = 'grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'

const filters = [
  { value: 'all', key: 'common.all' },
  { value: 'down', key: 'status.down' },
  { value: 'pending', key: 'status.pending' },
  { value: 'up', key: 'status.up' },
  { value: 'paused', key: 'status.paused' },
] as const

export function DashboardPage() {
  const { t, lang } = useI18n()
  const { id } = useParams()
  const selectedId = id ? Number(id) : null
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()
  const { data: monitors, isPending, isError, refetch } = useMonitors()
  const now = useNow(30_000)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | Eff>('all')
  const [collapsed, toggleCollapsed] = useCollapsedGroups()
  const narrowing = q.trim() !== '' || filter !== 'all'

  const filtered = useMemo(() => {
    const term = q.trim().toLocaleLowerCase(lang)
    return (monitors ?? [])
      .filter((m) => filter === 'all' || effectiveStatus(m) === filter)
      .filter(
        (m) =>
          !term ||
          m.name.toLocaleLowerCase(lang).includes(term) ||
          monitorTarget(m).toLocaleLowerCase(lang).includes(term),
      )
      .sort((a, b) => a.name.localeCompare(b.name, lang))
  }, [monitors, q, filter, lang])

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
    <div className="flex flex-col gap-4">
      <SummaryCards monitors={monitors} />

      {/* Toolbar */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative md:w-72">
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
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="bg-muted flex min-w-0 overflow-x-auto rounded-md p-0.5" role="tablist">
            {filters.map((f) => (
              <button
                key={f.value}
                role="tab"
                aria-selected={filter === f.value}
                onClick={() => setFilter(f.value)}
                className={cn(
                  'text-muted-foreground shrink-0 rounded-[5px] px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
                  filter === f.value && 'bg-background text-foreground shadow-xs',
                )}
              >
                {t(f.key)}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          {isAdmin && (
            <Button asChild size="sm" className="shrink-0">
              <Link to="/monitors/new">
                <Plus />
                {t('dash.add')}
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Monitors */}
      {isPending && (
        <div className={gridCls}>
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
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
            t('common.noResults')
          )}
        </Card>
      )}
      {grouped
        ? grouped.map((g) => {
            const isCollapsed = !narrowing && collapsed.has(g.key)
            return (
              <section key={g.key}>
                <button
                  type="button"
                  onClick={() => toggleCollapsed(g.key)}
                  aria-expanded={!isCollapsed}
                  className="text-muted-foreground hover:text-foreground mb-2 flex w-full items-center gap-2 rounded-md px-1 py-1 text-xs font-semibold tracking-wide uppercase"
                >
                  <ChevronRight className={cn('size-3.5 transition-transform', !isCollapsed && 'rotate-90')} />
                  <span className={cn('size-2 shrink-0 rounded-full', groupDot(g.monitors))} />
                  <span className="truncate">{g.name}</span>
                  <span className="tabular-nums">{g.monitors.length}</span>
                  <span className="bg-border h-px flex-1" />
                </button>
                {!isCollapsed && renderCards(g.monitors)}
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
