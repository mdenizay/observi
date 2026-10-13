import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Loader2, Pause, Pencil, Play, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { HeartbeatBar } from '@/components/heartbeat-bar'
import { LatencyChart } from '@/components/latency-chart'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useIsAdmin } from '@/hooks/use-auth'
import { useNow } from '@/hooks/use-now'
import { api, errorMessage } from '@/lib/api'
import {
  beatLabel,
  formatDateTime,
  formatLatency,
  formatRelative,
  formatUptime,
  monitorTarget,
} from '@/lib/format'
import type { BeatStatus, MonitorSummary } from '@/lib/types'
import { translateMessage } from '@/lib/messages'
import { cn } from '@/lib/utils'
import { richText, useI18n } from '@/i18n'

const ranges = [
  { hours: 1, key: 'range.1h', short: 'range.1h.short' },
  { hours: 24, key: 'range.24h', short: 'range.24h.short' },
  { hours: 168, key: 'range.7d', short: 'range.7d.short' },
  { hours: 720, key: 'range.30d', short: 'range.30d.short' },
] as const

const beatVariant: Record<BeatStatus, 'down' | 'up' | 'pending' | 'paused'> = {
  0: 'down',
  1: 'up',
  2: 'pending',
  3: 'paused',
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground truncate text-xs">{label}</div>
      <div className="mt-0.5 truncate text-lg font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-muted-foreground text-[11px]">{hint}</div>}
    </div>
  )
}

export function MonitorDetail({ monitor: m }: { monitor: MonitorSummary }) {
  const { t, lang } = useI18n()
  const isAdmin = useIsAdmin()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const now = useNow()
  const [hours, setHours] = useState<number>(24)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [toggling, setToggling] = useState(false)

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

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <Card className="gap-3">
        <CardContent className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-semibold tracking-tight">{m.name}</h2>
              <StatusBadge status={status} />
              <Badge variant="outline" className="text-muted-foreground font-normal">
                {t(`type.${m.type}` as const)}
              </Badge>
            </div>
            {target &&
              (isLink ? (
                <a
                  href={m.url!}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-muted-foreground hover:text-foreground mt-1 inline-flex max-w-full items-center gap-1 text-sm break-all"
                >
                  {target}
                  <ExternalLink className="size-3.5 shrink-0" />
                </a>
              ) : (
                <div className="text-muted-foreground mt-1 font-mono text-sm break-all">{target}</div>
              ))}
            {detail.data?.description && (
              <p className="text-muted-foreground mt-2 text-sm whitespace-pre-wrap">{detail.data.description}</p>
            )}
          </div>
          {isAdmin && (
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link to={`/monitors/${m.id}/edit`}>
                  <Pencil />
                  {t('common.edit')}
                </Link>
              </Button>
              <Button size="sm" variant="outline" onClick={toggleActive} disabled={toggling}>
                {toggling ? <Loader2 className="animate-spin" /> : m.active ? <Pause /> : <Play />}
                {m.active ? t('detail.pause') : t('detail.resume')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 />
                {t('common.delete')}
              </Button>
            </div>
          )}
        </CardContent>
        <CardContent>
          <HeartbeatBar beats={m.beats} max={50} size="lg" />
          <div className="text-muted-foreground mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs">
            <span>
              {m.last_check ? (
                <>
                  {t('detail.lastCheck')}{' '}
                  <span title={formatDateTime(m.last_check)}>{formatRelative(m.last_check, now)}</span>
                </>
              ) : (
                t('detail.notChecked')
              )}
              {' · '}
              {t('detail.every', { n: m.interval })}
            </span>
            {m.message && status !== 'up' && (
              <span className={cn('truncate', status === 'down' && 'text-down')} title={translateMessage(m.message, lang)}>
                {translateMessage(m.message, lang)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <Card className="py-3">
        <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-5">
          <Stat label={t('detail.latencyNow')} value={formatLatency(m.latency_ms)} />
          <Stat
            label={t('detail.avgLatency')}
            value={stats.isPending ? <Skeleton className="h-7 w-16" /> : formatLatency(stats.data?.avg_latency_24h)}
            hint={t('range.24h')}
          />
          <Stat
            label={t('detail.uptime')}
            value={stats.isPending ? <Skeleton className="h-7 w-16" /> : formatUptime(stats.data?.uptime_24h)}
            hint={t('range.24h')}
          />
          <Stat
            label={t('detail.uptime')}
            value={stats.isPending ? <Skeleton className="h-7 w-16" /> : formatUptime(stats.data?.uptime_7d)}
            hint={t('range.7d')}
          />
          <Stat
            label={t('detail.uptime')}
            value={stats.isPending ? <Skeleton className="h-7 w-16" /> : formatUptime(stats.data?.uptime_30d)}
            hint={t('range.30d')}
          />
        </CardContent>
      </Card>

      {/* Chart */}
      <Card className="gap-2">
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm">{t('detail.responseTime')}</CardTitle>
          <div className="bg-muted inline-flex rounded-md p-0.5" role="tablist">
            {ranges.map((r) => (
              <button
                key={r.hours}
                role="tab"
                aria-selected={hours === r.hours}
                title={t(r.key)}
                onClick={() => setHours(r.hours)}
                className={cn(
                  'text-muted-foreground rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors',
                  hours === r.hours && 'bg-background text-foreground shadow-xs',
                )}
              >
                <span className="sm:hidden">{t(r.short)}</span>
                <span className="hidden sm:inline">{t(r.key)}</span>
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="relative pr-2 pl-0">
          {beats.isPending ? (
            <Skeleton className="ml-4 h-[220px]" />
          ) : beats.isError ? (
            <div className="text-muted-foreground flex h-[220px] items-center justify-center text-sm">
              {t('common.loadFailed')}
            </div>
          ) : (
            <>
              <LatencyChart beats={beats.data ?? []} hours={hours} />
              {beats.isFetching && (
                <Loader2 className="text-muted-foreground absolute top-0 right-4 size-3.5 animate-spin" />
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Events */}
      <Card className="gap-2 pb-1">
        <CardHeader>
          <CardTitle className="text-sm">{t('detail.events')}</CardTitle>
        </CardHeader>
        <CardContent className="px-1">
          {events.isPending ? (
            <div className="space-y-2 px-3 pb-3">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : !events.data?.length ? (
            <div className="text-muted-foreground px-3 pb-4 text-sm">{t('detail.noEvents')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t('detail.colStatus')}</TableHead>
                  <TableHead>{t('detail.colTime')}</TableHead>
                  <TableHead className="w-full">{t('detail.colMessage')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.data.map((e, i) => (
                  <TableRow key={`${e.t}-${i}`}>
                    <TableCell>
                      <Badge variant={beatVariant[e.s] ?? 'muted'}>{beatLabel(e.s)}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground" title={formatDateTime(e.t)}>
                      {formatRelative(e.t, now)}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-0 truncate" title={e.m ? translateMessage(e.m, lang) : undefined}>
                      {e.m ? translateMessage(e.m, lang) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

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
