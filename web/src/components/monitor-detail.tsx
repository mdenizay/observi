import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, ExternalLink, Loader2, MoreHorizontal, Pause, Pencil, Play, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { HeartbeatBar } from '@/components/heartbeat-bar'
import { KpiTile, type Delta } from '@/components/kpi-tile'
import { Panel } from '@/components/panel'
import { LatencyChart } from '@/components/latency-chart'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { useIsAdmin } from '@/hooks/use-auth'
import { useNow } from '@/hooks/use-now'
import { richText, useI18n } from '@/i18n'
import { api, errorMessage } from '@/lib/api'
import {
  formatDateTime,
  formatDay,
  formatDuration,
  formatLatency,
  formatNumber,
  formatRelative,
  formatUptime,
  monitorTarget,
} from '@/lib/format'
import { translateMessage } from '@/lib/messages'
import type { Beat, MonitorEvent, MonitorSummary } from '@/lib/types'
import { cn } from '@/lib/utils'

const ranges = [
  { hours: 1, key: 'range.1h', short: 'range.1h.short' },
  { hours: 24, key: 'range.24h', short: 'range.24h.short' },
  { hours: 168, key: 'range.7d', short: 'range.7d.short' },
  { hours: 720, key: 'range.30d', short: 'range.30d.short' },
] as const

function Section({
  title,
  info,
  aside,
  children,
  bodyClassName = 'px-5 pb-5',
}: {
  title: string
  info?: string
  aside?: React.ReactNode
  children: React.ReactNode
  bodyClassName?: string
}) {
  return (
    <Panel title={title} info={info} actions={aside} bodyClassName={bodyClassName}>
      {children}
    </Panel>
  )
}

function Legend({ items }: { items: { cls: string; label: string }[] }) {
  return (
    <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span className={cn('h-3 w-1.5 rounded-full', it.cls)} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------ 30-day strip */

interface Day {
  start: number
  ratio: number | null
}

function dailyUptime(beats: Beat[], now: number): Day[] {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const days: Day[] = []
  const acc: { up: number; total: number }[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    days.push({ start: d.getTime(), ratio: null })
    acc.push({ up: 0, total: 0 })
  }
  for (const b of beats) {
    if (b.s === 3) continue // paused doesn't count
    let idx = -1
    for (let i = days.length - 1; i >= 0; i--) {
      if (b.t >= days[i].start) {
        idx = i
        break
      }
    }
    if (idx < 0) continue
    acc[idx].total++
    if (b.s === 1 || b.s === 2) acc[idx].up++
  }
  return days.map((d, i) => ({ ...d, ratio: acc[i].total ? (acc[i].up / acc[i].total) * 100 : null }))
}

function UptimeStrip({ monitorId, now }: { monitorId: number; now: number }) {
  const { t, lang } = useI18n()
  const q = useQuery({ queryKey: ['heartbeats', monitorId, 720], queryFn: () => api.heartbeats(monitorId, 720) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const days = useMemo(() => dailyUptime(q.data ?? [], now), [q.data, Math.floor(now / 3_600_000), lang])
  const tone = (r: number | null) =>
    r === null ? 'bg-bar-empty' : r >= 99.5 ? 'bg-bar-ok' : r >= 95 ? 'bg-pending' : 'bg-down'
  const withData = days.filter((d) => d.ratio !== null)
  const overall = withData.length ? withData.reduce((a, d) => a + (d.ratio ?? 0), 0) / withData.length : null
  return (
    <Section
      title={t('detail.uptime30')}
      info={t('info.uptime30')}
      aside={<span className="num pr-1 text-[13px] font-medium">{formatUptime(overall, 2)}</span>}
    >
      {q.isPending ? (
        <Skeleton className="h-9 w-full" />
      ) : (
        <>
          <div className="grid grid-cols-[repeat(30,minmax(0,1fr))] gap-1" role="img" aria-label={t('detail.uptime30')}>
            {days.map((d) => (
              <span
                key={d.start}
                title={`${formatDay(d.start)} · ${d.ratio === null ? t('detail.noData') : formatUptime(d.ratio, 2)}`}
                className={cn('h-9 w-full rounded-full transition-opacity hover:opacity-70', tone(d.ratio))}
              />
            ))}
          </div>
          <div className="text-muted-foreground num mt-2 flex justify-between text-[11px]">
            <span>{formatDay(days[0].start)}</span>
            <span>{t('detail.today')}</span>
          </div>
          <Legend
            items={[
              { cls: 'bg-bar-ok', label: t('legend.healthy') },
              { cls: 'bg-pending', label: t('legend.degraded') },
              { cls: 'bg-down', label: t('legend.outage') },
              { cls: 'bg-bar-empty', label: t('detail.noData') },
            ]}
          />
        </>
      )}
    </Section>
  )
}

/* ------------------------------------------------------------ incidents */

interface Incident {
  start: number
  end: number | null
  message: string | null
}

function buildIncidents(events: MonitorEvent[]): Incident[] {
  const asc = [...events].sort((a, b) => a.t - b.t)
  const out: Incident[] = []
  let open: Incident | null = null
  for (const e of asc) {
    if (e.s === 0 && !open) {
      open = { start: e.t, end: null, message: e.m }
      out.push(open)
    } else if (e.s === 1 && open) {
      open.end = e.t
      open = null
    }
  }
  return out.reverse()
}

function Incidents({ events, loading, now, currentlyDown }: { events: MonitorEvent[] | undefined; loading: boolean; now: number; currentlyDown: boolean }) {
  const { t, lang } = useI18n()
  const incidents = useMemo(() => buildIncidents(events ?? []).slice(0, 12), [events])
  return (
    <Section title={t('detail.incidents')} info={t('info.incidents')} bodyClassName="">
      {loading ? (
        <div className="grid gap-2 p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : incidents.length === 0 ? (
        <p className="text-muted-foreground p-4 text-sm">{t('detail.noIncidents')}</p>
      ) : (
        <div role="table" className="text-sm">
          <div role="row" className="grid grid-cols-[minmax(0,1.3fr)_5.5rem_6rem] gap-3 border-b px-4 py-2.5">
            <span role="columnheader" className="text-muted-foreground text-xs">{t('detail.colStarted')}</span>
            <span role="columnheader" className="text-muted-foreground text-xs">{t('detail.colDuration')}</span>
            <span role="columnheader" className="text-muted-foreground text-right text-xs">{t('col.status')}</span>
          </div>
          {incidents.map((inc) => {
            const ongoing = inc.end === null && currentlyDown
            const duration = formatDuration((inc.end ?? now) - inc.start)
            return (
              <div
                role="row"
                key={inc.start}
                className={cn('border-b px-4 py-3 last:border-b-0', ongoing && 'bg-down/[0.05]')}
              >
                <div className="grid grid-cols-[minmax(0,1.3fr)_5.5rem_6rem] items-center gap-3">
                  <span role="cell" className="num truncate text-[13px]" title={formatDateTime(inc.start)}>
                    {formatDateTime(inc.start)}
                  </span>
                  <span role="cell" className="num text-muted-foreground text-[13px]">
                    {duration}
                  </span>
                  <span role="cell" className="flex justify-end">
                    <Badge variant={ongoing ? 'down' : 'up'} className="gap-1.5 pl-2">
                      <span className="size-1.5 rounded-full bg-current" />
                      {ongoing ? t('detail.ongoing') : t('detail.resolved')}
                    </Badge>
                  </span>
                </div>
                {inc.message && (
                  <div className="text-muted-foreground mt-1 truncate text-xs" title={translateMessage(inc.message, lang)}>
                    {translateMessage(inc.message, lang)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}

/* ------------------------------------------------------------ main */

export function MonitorDetail({ monitor: m }: { monitor: MonitorSummary }) {
  const { t, lang } = useI18n()
  const isAdmin = useIsAdmin()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const now = useNow()
  const [hours, setHours] = useState<number>(24)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [copied, setCopied] = useState(false)

  const detail = useQuery({ queryKey: ['monitor', m.id], queryFn: () => api.monitor(m.id) })
  const stats = useQuery({ queryKey: ['stats', m.id], queryFn: () => api.stats(m.id), refetchInterval: 60_000 })
  const beats = useQuery({
    queryKey: ['heartbeats', m.id, hours],
    queryFn: () => api.heartbeats(m.id, hours),
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === m.id ? prev : undefined),
  })
  const events = useQuery({ queryKey: ['events', m.id], queryFn: () => api.events(m.id, 50) })

  // Honest comparison: current response vs the 24h average (both from the API).
  const avg24 = stats.data?.avg_latency_24h
  const latencyDelta: Delta | undefined =
    m.latency_ms != null && avg24 != null && avg24 > 0 && m.active
      ? (() => {
          const pct = ((m.latency_ms - avg24) / avg24) * 100
          return {
            dir: pct >= 0 ? 'up' : 'down',
            good: pct <= 0,
            text: `${formatNumber(Math.abs(pct), 1)}%`,
          }
        })()
      : undefined

  const target = monitorTarget(m)
  const isLink = m.type !== 'tcp' && !!m.url
  const status = m.active ? m.status : 'paused'

  const toggleActive = async () => {
    setToggling(true)
    try {
      if (m.active) await api.pauseMonitor(m.id)
      else await api.resumeMonitor(m.id)
      toast.success(m.active ? t('detail.paused') : t('detail.resumed'))
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['monitors'] }),
        qc.invalidateQueries({ queryKey: ['monitor', m.id] }),
      ])
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setToggling(false)
    }
  }

  const doDelete = async () => {
    try {
      await api.deleteMonitor(m.id)
      toast.success(t('detail.deleted'))
      qc.setQueryData<MonitorSummary[]>(['monitors'], (old) => old?.filter((x) => x.id !== m.id))
      qc.removeQueries({ queryKey: ['monitor', m.id] })
      navigate('/dashboard', { replace: true })
      qc.invalidateQueries({ queryKey: ['monitors'] })
    } catch (e) {
      toast.error(errorMessage(e))
      throw e
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(target)
      setCopied(true)
      toast.success(t('detail.copied'))
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4 sm:p-5">
      {/* Header */}
      <header className="pr-10">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 truncate text-lg font-semibold tracking-tight">{m.name}</h2>
          <StatusBadge status={status} />
          <Badge variant="outline" className="text-muted-foreground font-normal">
            {t(`type.${m.type}` as const)}
          </Badge>
        </div>
        {target && (
          <div className="mt-1.5 flex min-w-0 items-center gap-1">
            {isLink ? (
              <a
                href={m.url!}
                target="_blank"
                rel="noreferrer noopener"
                className="text-muted-foreground hover:text-foreground inline-flex min-w-0 items-center gap-1 text-sm"
              >
                <span className="truncate">{target}</span>
                <ExternalLink className="size-3.5 shrink-0" />
              </a>
            ) : (
              <span className="text-muted-foreground num truncate text-sm">{target}</span>
            )}
            <Button size="icon-sm" variant="ghost" className="size-7 shrink-0" onClick={copy} aria-label={t('detail.copy')} title={t('detail.copy')}>
              {copied ? <Check className="text-up size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
        )}
        {detail.data?.description && (
          <p className="text-muted-foreground mt-2 text-sm whitespace-pre-wrap">{detail.data.description}</p>
        )}
      </header>

      {isAdmin && (
        <div className="flex items-center gap-2">
          <div className="bg-card shadow-xs flex rounded-lg border">
            <Button asChild size="sm" variant="ghost" className="rounded-r-none border-r">
              <Link to={`/monitors/${m.id}/edit`}>
                <Pencil />
                {t('common.edit')}
              </Link>
            </Button>
            <Button size="sm" variant="ghost" className="rounded-l-none" onClick={toggleActive} disabled={toggling}>
              {toggling ? <Loader2 className="animate-spin" /> : m.active ? <Pause /> : <Play />}
              {m.active ? t('detail.pause') : t('detail.resume')}
            </Button>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="outline" aria-label={t('detail.more')} title={t('detail.more')}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-40">
              <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)}>
                <Trash2 />
                {t('common.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Recent beats */}
      <Section title={t('detail.recentChecks')} info={t('info.heartbeats')}>
        <HeartbeatBar beats={m.beats} max={50} size="lg" stretch />
        <div className="text-muted-foreground mt-2.5 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs">
          <span>
            {m.last_check ? (
              <>
                {t('detail.lastCheck')}{' '}
                <span className="text-foreground" title={formatDateTime(m.last_check)}>
                  {formatRelative(m.last_check, now)}
                </span>
              </>
            ) : (
              t('detail.notChecked')
            )}
            <span className="mx-1.5 opacity-50">/</span>
            {t('detail.every', { n: m.interval })}
          </span>
          {m.message && status !== 'up' && (
            <span className={cn('min-w-0 truncate', status === 'down' && 'text-down')} title={translateMessage(m.message, lang)}>
              {translateMessage(m.message, lang)}
            </span>
          )}
        </div>
      </Section>

      {/* KPIs */}
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <KpiTile
            label={t('detail.kpiCurrent')}
            value={formatLatency(m.latency_ms)}
            delta={latencyDelta}
            sub={stats.data?.avg_latency_24h != null ? t('detail.vsAvg', { avg: formatLatency(stats.data.avg_latency_24h) }) : undefined}
          />
          <KpiTile
            label={t('detail.kpiAvg')}
            value={stats.isPending ? <Skeleton className="h-8 w-16" /> : formatLatency(stats.data?.avg_latency_24h)}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              ['range.24h.short', stats.data?.uptime_24h],
              ['range.7d.short', stats.data?.uptime_7d],
              ['range.30d.short', stats.data?.uptime_30d],
            ] as const
          ).map(([k, v]) => (
            <KpiTile
              key={k}
              label={
                <>
                  <span className="hidden sm:inline">{t('detail.uptime')} · </span>
                  {t(k)}
                </>
              }
              value={stats.isPending ? <Skeleton className="h-8 w-14" /> : <span className="text-xl sm:text-2xl">{formatUptime(v)}</span>}
            />
          ))}
        </div>
      </div>

      {/* Chart */}
      <Section
        title={t('detail.responseTime')}
        info={t('info.chart')}
        aside={
          <div className="bg-muted flex rounded-full p-1" role="tablist">
            {ranges.map((r) => (
              <button
                key={r.hours}
                role="tab"
                aria-selected={hours === r.hours}
                title={t(r.key)}
                onClick={() => setHours(r.hours)}
                className={cn(
                  'text-muted-foreground hover:text-foreground num rounded-md px-2 py-1 text-xs font-medium transition-colors',
                  hours === r.hours && 'bg-card text-foreground shadow-xs dark:bg-accent',
                )}
              >
                {t(r.short)}
              </button>
            ))}
          </div>
        }
      >
        <div className="relative -ml-1">
          {beats.isPending ? (
            <Skeleton className="ml-1 h-[220px]" />
          ) : beats.isError ? (
            <div className="text-muted-foreground flex h-[220px] items-center justify-center text-sm">
              {t('common.loadFailed')}
            </div>
          ) : (
            <>
              <LatencyChart beats={beats.data ?? []} hours={hours} />
              {beats.isFetching && (
                <Loader2 className="text-muted-foreground absolute top-0 right-1 size-3.5 animate-spin" />
              )}
            </>
          )}
        </div>
      </Section>

      <UptimeStrip monitorId={m.id} now={now} />
      <Incidents events={events.data} loading={events.isPending} now={now} currentlyDown={status === 'down'} />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('detail.deleteTitle')}
        description={richText(t('detail.deleteDesc'), { name: <strong className="text-foreground">{m.name}</strong> })}
        onConfirm={doDelete}
      />
    </div>
  )
}
