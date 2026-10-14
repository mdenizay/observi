import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BellOff, Check, Copy, ExternalLink, Loader2, MoreHorizontal, Pause, Pencil, Play, Trash2, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { HeartbeatBar } from '@/components/heartbeat-bar'
import { LatencyChart } from '@/components/latency-chart'
import { MaintenanceForm } from '@/components/maintenance-ui'
import { maintenanceTip } from '@/lib/maintenance'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
  formatDate,
  formatDay,
  formatDuration,
  formatLatency,
  formatRelative,
  formatUptime,
  monitorTarget,
} from '@/lib/format'
import { TagChip } from '@/components/tags'
import { sslReasonLabel } from '@/lib/cert'
import { translateMessage } from '@/lib/messages'
import type { Beat, CertInfo, DomainInfo, MonitorEvent, MonitorSummary } from '@/lib/types'
import { cn } from '@/lib/utils'

const ranges = [
  { hours: 1, key: 'range.1h', short: 'range.1h.short' },
  { hours: 24, key: 'range.24h', short: 'range.24h.short' },
  { hours: 168, key: 'range.7d', short: 'range.7d.short' },
  { hours: 720, key: 'range.30d', short: 'range.30d.short' },
] as const

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-card shadow-card rounded-xl border p-4">
      <div className="mb-3 flex min-h-7 items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Kpi({
  label,
  value,
  loading,
  tone,
  sub,
  title,
}: {
  label: string
  value: string
  loading?: boolean
  tone?: 'warn' | 'bad'
  sub?: React.ReactNode
  title?: string
}) {
  return (
    <div
      title={title}
      className={cn(
        'bg-card shadow-card min-w-0 rounded-xl border px-3.5 py-3',
        tone === 'warn' && 'border-pending/40 bg-pending/[0.05]',
        tone === 'bad' && 'border-down/40 bg-down/[0.05]',
      )}
    >
      <div className="text-muted-foreground truncate text-xs">{label}</div>
      {loading ? (
        <Skeleton className="mt-1.5 h-6 w-16" />
      ) : (
        <div className={cn('num mt-1 truncate text-lg font-semibold', tone === 'warn' && 'text-pending', tone === 'bad' && 'text-down')}>
          {value}
        </div>
      )}
      {sub}
    </div>
  )
}

/** Domain registration KPI (only for monitors whose host has a registrable domain). */
function DomainKpi({ domain }: { domain: DomainInfo }) {
  const { t } = useI18n()
  const unknown = domain.status === 'unknown' || domain.expires_at == null
  const expired = domain.status === 'expired'
  const value = unknown
    ? '—'
    : expired
      ? t('ssl.expiredAgo', { count: Math.max(0, Math.abs(domain.days_left ?? 0)) })
      : t('ssl.days', { count: domain.days_left ?? 0 })
  const tone = expired ? 'bad' : domain.status === 'expiring' ? 'warn' : undefined
  const main = unknown
    ? (domain.error ?? domain.name)
    : expired
      ? t('ssl.expiredOn', { date: formatDate(domain.expires_at!) })
      : t('ssl.validUntil', { date: formatDate(domain.expires_at!) })
  return (
    <Kpi
      label={`${t('dom.title')} · ${domain.name}`}
      value={value}
      tone={tone}
      sub={
        <div className="mt-0.5 min-w-0">
          <div className={cn('text-xs [overflow-wrap:anywhere]', tone === 'bad' ? 'text-down' : tone === 'warn' ? 'text-pending' : 'text-muted-foreground')}>
            {main}
          </div>
          {domain.registrar && (
            <div className="text-muted-foreground/80 truncate text-[11px]" title={domain.registrar}>
              {t('dom.registrar', { registrar: domain.registrar })}
            </div>
          )}
        </div>
      }
    />
  )
}

/** SSL certificate KPI (only for monitors that have certificate info). */
function CertKpi({ cert, problem, now }: { cert: CertInfo | null; problem: string | null; now: number }) {
  const { t } = useI18n()
  const expired = cert?.status === 'expired'
  const date = cert ? formatDate(cert.expires_at) : ''
  const value = expired
    ? t('ssl.expiredAgo', { count: Math.max(0, Math.abs(cert!.days_left)) })
    : problem
      ? t('ssl.invalid')
      : t('ssl.days', { count: cert!.days_left })
  const tone = expired || problem ? 'bad' : cert?.status === 'expiring' ? 'warn' : undefined
  const details = [
    cert?.issuer ? t('ssl.issuer', { issuer: cert.issuer }) : null,
    cert ? t('ssl.checked', { time: formatRelative(cert.checked_at, now) }) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const main = problem
    ? sslReasonLabel(problem)
    : expired
      ? t('ssl.expiredOn', { date })
      : t('ssl.validUntil', { date })
  return (
    <Kpi
      label={t('ssl.title')}
      value={value}
      tone={tone}
      title={details}
      sub={
        <div className="mt-0.5 min-w-0">
          <div className={cn('truncate text-xs', tone === 'bad' ? 'text-down' : tone === 'warn' ? 'text-pending' : 'text-muted-foreground')}>
            {main}
          </div>
          {details && (
            <div className="text-muted-foreground/80 truncate text-[11px]" title={details}>
              {details}
            </div>
          )}
        </div>
      }
    />
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
    if (b.s === 3 || b.s === 4) continue // paused / maintenance don't count
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
    r === null ? 'bg-empty' : r >= 99.5 ? 'bg-up' : r >= 95 ? 'bg-pending' : 'bg-down'
  const withData = days.filter((d) => d.ratio !== null)
  const overall = withData.length ? withData.reduce((a, d) => a + (d.ratio ?? 0), 0) / withData.length : null
  return (
    <Section title={t('detail.uptime30')} aside={<span className="num text-sm font-medium">{formatUptime(overall, 2)}</span>}>
      {q.isPending ? (
        <Skeleton className="h-9 w-full" />
      ) : (
        <>
          <div className="flex h-9 items-stretch gap-[3px]" role="img" aria-label={t('detail.uptime30')}>
            {days.map((d) => (
              <span
                key={d.start}
                title={`${formatDay(d.start)} · ${d.ratio === null ? t('detail.noData') : formatUptime(d.ratio, 2)}`}
                className={cn('min-w-0 flex-1 rounded-[3px] transition-opacity hover:opacity-70', tone(d.ratio))}
              />
            ))}
          </div>
          <div className="text-muted-foreground mt-2 flex justify-between text-xs">
            <span>{formatDay(days[0].start)}</span>
            <span>{t('detail.today')}</span>
          </div>
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
    <Section title={t('detail.incidents')}>
      {loading ? (
        <div className="grid gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : incidents.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('detail.noIncidents')}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2">
          {incidents.map((inc) => {
            const ongoing = inc.end === null && currentlyDown
            const duration = formatDuration((inc.end ?? now) - inc.start)
            return (
              <li
                key={inc.start}
                className={cn(
                  'flex min-w-0 items-start gap-3 rounded-lg border px-3 py-2.5',
                  ongoing ? 'border-down/35 bg-down/[0.06]' : 'bg-muted/30',
                )}
              >
                <span
                  className={cn('mt-1.5 size-2 shrink-0 rounded-full', ongoing ? 'bg-down live-dot text-down' : 'bg-up')}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="num text-sm font-medium" title={formatDateTime(inc.start)}>
                      {formatDateTime(inc.start)}
                    </span>
                    <Badge variant={ongoing ? 'down' : 'muted'} className="h-5">
                      {ongoing ? t('detail.ongoing') : t('detail.resolved')}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground mt-0.5 min-w-0 text-xs">
                    {ongoing ? t('detail.downFor', { duration }) : t('detail.lasted', { duration })}
                    {inc.message && (
                      <span className="text-foreground/80 mt-0.5 block min-w-0 [overflow-wrap:anywhere]">
                        {translateMessage(inc.message, lang)}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
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
  const [maintOpen, setMaintOpen] = useState(false)
  const [maintBusy, setMaintBusy] = useState(false)

  const refreshMonitors = async () => {
    await qc.invalidateQueries({ queryKey: ['monitors'] })
    qc.invalidateQueries({ queryKey: ['monitor', m.id] })
  }
  const startMaintenance = async (minutes: number, muteOnly: boolean) => {
    setMaintBusy(true)
    try {
      await api.bulkMonitors({ ids: [m.id], action: muteOnly ? 'mute' : 'maintenance', duration_min: minutes })
      toast.success(muteOnly ? t('bulk.mutedN', { count: 1 }) : t('bulk.maintStarted', { count: 1 }))
      setMaintOpen(false)
      await refreshMonitors()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setMaintBusy(false)
    }
  }
  const endMaintenance = async () => {
    if (!m.maintenance) return
    setMaintBusy(true)
    try {
      await api.maintenanceEnd(m.maintenance.id)
      toast.success(t('maint.bannerEnded'))
      await refreshMonitors()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setMaintBusy(false)
    }
  }
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
    <div className="flex min-w-0 flex-col gap-3 p-4 sm:p-5 [&>*]:min-w-0">
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
        {m.tags?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {m.tags.map((x) => (
              <TagChip key={x} name={x} className="h-6 text-xs" />
            ))}
          </div>
        )}
        {detail.data?.description && (
          <p className="text-muted-foreground mt-2 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">{detail.data.description}</p>
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
              <DropdownMenuItem onSelect={() => setMaintOpen(true)}>
                <Wrench />
                {t('maint.menu')}
              </DropdownMenuItem>
              <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)}>
                <Trash2 />
                {t('common.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {m.maintenance && (
        <div
          role="status"
          className={cn(
            'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3.5 py-2.5 text-sm',
            m.maintenance.kind === 'maintenance' ? 'border-maint/35 bg-maint/[0.07]' : 'bg-muted/50',
          )}
        >
          {m.maintenance.kind === 'maintenance' ? (
            <Wrench className="text-maint size-4 shrink-0" />
          ) : (
            <BellOff className="text-muted-foreground size-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1">{maintenanceTip(m.maintenance, t)}</span>
          {isAdmin && (
            <Button size="xs" variant="outline" onClick={endMaintenance} disabled={maintBusy}>
              {maintBusy && <Loader2 className="animate-spin" />}
              {t('maint.endNow')}
            </Button>
          )}
        </div>
      )}

      <Dialog open={maintOpen} onOpenChange={setMaintOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('maint.menu')}</DialogTitle>
            <DialogDescription>{m.name}</DialogDescription>
          </DialogHeader>
          <div className="-mx-3 -mb-3">
            <MaintenanceForm idPrefix="drawer" busy={maintBusy} onApply={startMaintenance} />
          </div>
        </DialogContent>
      </Dialog>

      {/* Recent beats */}
      <section className="bg-card shadow-card rounded-xl border p-4">
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
            <span className={cn('min-w-0 max-w-full [overflow-wrap:anywhere]', status === 'down' && 'text-down')}>
              {translateMessage(m.message, lang)}
            </span>
          )}
        </div>
      </section>

      {/* KPIs */}
      <div className="grid gap-2">
        <div className="grid grid-cols-2 gap-2">
          <Kpi label={t('detail.kpiCurrent')} value={formatLatency(m.latency_ms)} />
          <Kpi label={t('detail.kpiAvg')} value={formatLatency(stats.data?.avg_latency_24h)} loading={stats.isPending} />
        </div>
        {(m.cert || m.ssl_problem || m.domain) && (
          <div className={cn('grid gap-2', (m.cert || m.ssl_problem) && m.domain && 'sm:grid-cols-2')}>
            {(m.cert || m.ssl_problem) && <CertKpi cert={m.cert} problem={m.ssl_problem} now={now} />}
            {m.domain && <DomainKpi domain={m.domain} />}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <Kpi label={t('detail.kpiUptime', { range: t('range.24h.short') })} value={formatUptime(stats.data?.uptime_24h)} loading={stats.isPending} />
          <Kpi label={t('detail.kpiUptime', { range: t('range.7d.short') })} value={formatUptime(stats.data?.uptime_7d)} loading={stats.isPending} />
          <Kpi label={t('detail.kpiUptime', { range: t('range.30d.short') })} value={formatUptime(stats.data?.uptime_30d)} loading={stats.isPending} />
        </div>
      </div>

      {/* Chart */}
      <Section
        title={t('detail.responseTime')}
        aside={
          <div className="bg-muted flex rounded-lg border p-0.5" role="tablist">
            {ranges.map((r) => (
              <button
                key={r.hours}
                role="tab"
                aria-selected={hours === r.hours}
                title={t(r.key)}
                onClick={() => setHours(r.hours)}
                className={cn(
                  'text-muted-foreground hover:text-foreground num rounded-md px-2 py-1 text-xs font-medium transition-colors',
                  hours === r.hours && 'bg-card text-foreground shadow-xs',
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
