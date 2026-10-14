import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Loader2, RefreshCw, Send } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app-shell'
import { Field } from '@/components/field'
import { Tabs } from '@/components/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useIsAdmin } from '@/hooks/use-auth'
import { useMonitors } from '@/hooks/use-monitors'
import { useI18n } from '@/i18n'
import { api, errorMessage } from '@/lib/api'
import { formatDate, formatDateTime, formatDuration, formatLatency, formatNumber, formatRelative, formatUptime } from '@/lib/format'
import type { DomainItem, ReportMonitorRow, ReportSettings } from '@/lib/types'
import { cn } from '@/lib/utils'

type TabId = 'uptime' | 'expiry' | 'schedule'

const selectCls =
  'border-input bg-card dark:bg-input/20 focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-lg border px-2.5 text-sm shadow-xs outline-none focus-visible:ring-[3px]'

/* ------------------------------------------------------------------ uptime */

type SortKey = 'name' | 'group' | 'uptime' | 'incidents' | 'downtime' | 'avg'

function uptimeTone(v: number | null) {
  if (v === null) return { text: 'text-muted-foreground', bar: 'bg-muted-foreground/30' }
  if (v >= 99.9) return { text: 'text-up', bar: 'bg-up' }
  if (v >= 99) return { text: 'text-pending', bar: 'bg-pending' }
  return { text: 'text-down', bar: 'bg-down' }
}

function Stat({ label, value, loading }: { label: string; value: string; loading?: boolean }) {
  return (
    <div className="bg-card shadow-card min-w-0 rounded-xl border px-4 py-3">
      <div className="text-muted-foreground truncate text-xs font-medium">{label}</div>
      {loading ? <Skeleton className="mt-1.5 h-7 w-20" /> : <div className="num mt-1 truncate text-2xl font-semibold">{value}</div>}
    </div>
  )
}

function csvCell(v: string | number | null) {
  const s = v === null ? '' : String(v)
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function UptimeTab() {
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const [days, setDays] = useState<7 | 30 | 90>(7)
  const [grouped, setGrouped] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'uptime', dir: 'asc' })
  const q = useQuery({ queryKey: ['report', days], queryFn: () => api.reportSummary(days), staleTime: 60_000 })

  const ungrouped = t('dash.ungrouped')
  const rows = useMemo(() => {
    const val = (r: ReportMonitorRow): string | number | null =>
      sort.key === 'name' ? r.name : sort.key === 'group' ? (r.group_name ?? '') : sort.key === 'uptime' ? r.uptime : sort.key === 'incidents' ? r.incidents : sort.key === 'downtime' ? r.downtime_ms : r.avg_latency
    const list = [...(q.data?.monitors ?? [])]
    list.sort((a, b) => {
      const x = val(a)
      const y = val(b)
      let c: number
      if (x === null && y === null) c = 0
      else if (x === null) c = 1 // nulls last regardless of direction
      else if (y === null) c = -1
      else c = typeof x === 'string' ? x.localeCompare(String(y), lang) : (x as number) - (y as number)
      if ((x === null) !== (y === null)) return c
      return sort.dir === 'asc' ? c : -c
    })
    return list
  }, [q.data, sort, lang])

  const sections = useMemo(() => {
    if (!grouped) return [{ key: '', name: '', rows }]
    const map = new Map<string, ReportMonitorRow[]>()
    for (const r of rows) {
      const k = r.group_name ?? ''
      map.set(k, [...(map.get(k) ?? []), r])
    }
    return [...map.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, lang)))
      .map(([k, rs]) => ({ key: k, name: k || ungrouped, rows: rs }))
  }, [rows, grouped, lang, ungrouped])

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'group' ? 'asc' : 'desc' }))

  const exportCsv = () => {
    const head = [t('col.monitor'), t('rep.colGroup'), t('rep.statUptime'), t('rep.statIncidents'), t('rep.colDowntime'), t('rep.statAvg')]
    const lines = [head.map(csvCell).join(',')]
    for (const r of rows)
      lines.push(
        [r.name, r.group_name ?? '', r.uptime === null ? '' : r.uptime.toFixed(3), r.incidents, Math.round(r.downtime_ms / 1000), r.avg_latency === null ? '' : Math.round(r.avg_latency)]
          .map(csvCell)
          .join(','),
      )
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `uptime-${days}d-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const head = (key: SortKey, label: string, right = false) => (
    <TableHead className={cn(right && 'text-right')} aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className={cn('hover:text-foreground focus-visible:ring-ring/50 inline-flex items-center gap-1 rounded outline-none focus-visible:ring-2', right && 'flex-row-reverse', sort.key === key && 'text-foreground')}
      >
        {label}
        {sort.key === key ? sort.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-50" />}
      </button>
    </TableHead>
  )

  const d = q.data
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="bg-muted flex rounded-lg border p-0.5" role="radiogroup" aria-label={t('rep.period')}>
          {([7, 30, 90] as const).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={days === n}
              onClick={() => setDays(n)}
              className={cn('text-muted-foreground rounded-md px-3 py-1.5 text-sm font-medium transition-colors', days === n && 'bg-card text-foreground shadow-xs')}
            >
              {t(n === 7 ? 'range.7d' : n === 30 ? 'range.30d' : 'rep.d90')}
            </button>
          ))}
        </div>
        {d && (
          <span className="text-muted-foreground text-xs">
            {formatDate(d.from)} – {formatDate(d.to)}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Switch checked={grouped} onCheckedChange={setGrouped} aria-label={t('rep.groupBy')} />
            {t('rep.groupBy')}
          </label>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!d || rows.length === 0}>
            <Download />
            {t('rep.export')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label={t('rep.statUptime')} value={d ? formatUptime(d.uptime, 3) : ''} loading={q.isPending} />
        <Stat label={t('rep.statMonitors')} value={d ? formatNumber(d.monitors.length) : ''} loading={q.isPending} />
        <Stat label={t('rep.statIncidents')} value={d ? formatNumber(d.incidents) : ''} loading={q.isPending} />
        <Stat label={t('rep.statDowntime')} value={d ? (d.downtime_ms > 0 ? formatDuration(d.downtime_ms) : '0') : ''} loading={q.isPending} />
        <Stat label={t('rep.statAvg')} value={d ? formatLatency(d.avg_latency) : ''} loading={q.isPending} />
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        {q.isPending ? (
          <div className="grid gap-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : q.isError ? (
          <div className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <span className="text-muted-foreground min-w-0 flex-1">
              {t('rep.failed')} {errorMessage(q.error)}
            </span>
            <Button size="sm" variant="outline" onClick={() => q.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground p-10 text-center text-sm">{t('rep.empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {head('name', t('col.monitor'))}
                {!grouped && head('group', t('rep.colGroup'))}
                {head('uptime', t('rep.statUptime'))}
                {head('incidents', t('rep.statIncidents'), true)}
                {head('downtime', t('rep.colDowntime'), true)}
                {head('avg', t('rep.statAvg'), true)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sections.map((sec) => (
                <GroupRows key={sec.key} name={grouped ? sec.name : null} cols={grouped ? 5 : 6} rows={sec.rows} grouped={grouped} onOpen={(id) => navigate(`/dashboard/${id}`)} />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}

function GroupRows({ name, cols, rows, grouped, onOpen }: { name: string | null; cols: number; rows: ReportMonitorRow[]; grouped: boolean; onOpen: (id: number) => void }) {
  const { t } = useI18n()
  return (
    <>
      {name !== null && (
        <TableRow className="bg-muted/40 hover:bg-muted/40">
          <TableCell colSpan={cols} className="text-xs font-semibold">
            {name} <span className="text-muted-foreground num font-normal">{rows.length}</span>
          </TableCell>
        </TableRow>
      )}
      {rows.map((r) => {
        const tone = uptimeTone(r.uptime)
        return (
          <TableRow key={r.id} tabIndex={0} role="link" onClick={() => onOpen(r.id)} onKeyDown={(e) => e.key === 'Enter' && onOpen(r.id)} className="cursor-pointer focus-visible:bg-accent/60 outline-none">
            <TableCell className="max-w-56 truncate text-sm font-medium">{r.name}</TableCell>
            {!grouped && <TableCell className="text-muted-foreground max-w-40 truncate text-sm">{r.group_name ?? t('dash.ungrouped')}</TableCell>}
            <TableCell>
              <div className="flex min-w-32 items-center gap-2.5">
                <div className="bg-muted h-1.5 w-16 shrink-0 overflow-hidden rounded-full" aria-hidden>
                  <div className={cn('h-full rounded-full', tone.bar)} style={{ width: `${r.uptime === null ? 0 : Math.max(2, r.uptime)}%` }} />
                </div>
                <span className={cn('num text-sm font-medium', tone.text)}>{r.uptime === null ? '—' : formatUptime(r.uptime, 3)}</span>
              </div>
            </TableCell>
            <TableCell className="num text-right text-sm">{formatNumber(r.incidents)}</TableCell>
            <TableCell className="num text-muted-foreground text-right text-sm">{r.downtime_ms > 0 ? formatDuration(r.downtime_ms) : '—'}</TableCell>
            <TableCell className="num text-right text-sm">{formatLatency(r.avg_latency)}</TableCell>
          </TableRow>
        )
      })}
    </>
  )
}

/* ------------------------------------------------------------------ expiry */

interface ExpiryRow {
  key: string
  type: 'ssl' | 'domain'
  name: string
  monitorId: number | null
  expires: number | null
  days: number | null
  status: 'ok' | 'expiring' | 'expired' | 'unknown'
  who: string | null
  checked: number | null
}

function ExpiryTab() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isAdmin = useIsAdmin()
  const monitors = useMonitors()
  const domains = useQuery({ queryKey: ['domains'], queryFn: api.domains, select: (d) => d.items, staleTime: 60_000 })
  const [filter, setFilter] = useState<'all' | 'expiring' | 'expired'>('all')
  const [checking, setChecking] = useState(false)

  const rows = useMemo<ExpiryRow[]>(() => {
    const out: ExpiryRow[] = []
    for (const m of monitors.data ?? [])
      if (m.cert)
        out.push({ key: `s${m.id}`, type: 'ssl', name: m.name, monitorId: m.id, expires: m.cert.expires_at, days: m.cert.days_left, status: m.cert.status, who: m.cert.issuer, checked: m.cert.checked_at })
    for (const d of (domains.data ?? []) as DomainItem[])
      out.push({ key: `d${d.name}`, type: 'domain', name: d.name, monitorId: d.monitor_ids[0] ?? null, expires: d.expires_at, days: d.days_left, status: d.status, who: d.registrar, checked: d.checked_at })
    return out.sort((a, b) => (a.expires ?? Infinity) - (b.expires ?? Infinity))
  }, [monitors.data, domains.data])

  const shown = rows.filter((r) => filter === 'all' || r.status === filter)

  const recheck = async () => {
    setChecking(true)
    try {
      await api.domainsCheck()
      toast.message(t('rep.rechecking'))
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['domains'] })
        setChecking(false)
      }, 5000)
    } catch (e) {
      toast.error(errorMessage(e))
      setChecking(false)
    }
  }

  const pill = (s: ExpiryRow['status']) => {
    const label = t(s === 'ok' ? 'rep.stOk' : s === 'expiring' ? 'rep.stExpiring' : s === 'expired' ? 'rep.stExpired' : 'rep.stUnknown')
    return <Badge variant={s === 'ok' ? 'up' : s === 'expiring' ? 'pending' : s === 'expired' ? 'down' : 'muted'}>{label}</Badge>
  }
  const loading = monitors.isPending || domains.isPending
  const failed = domains.isError

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="bg-muted flex rounded-lg border p-0.5" role="radiogroup" aria-label={t('rep.exStatus')}>
          {(['all', 'expiring', 'expired'] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={filter === f}
              onClick={() => setFilter(f)}
              className={cn('text-muted-foreground rounded-md px-3 py-1.5 text-sm font-medium transition-colors', filter === f && 'bg-card text-foreground shadow-xs')}
            >
              {t(f === 'all' ? 'common.all' : f === 'expiring' ? 'rep.exExpiring' : 'rep.exExpired')}
            </button>
          ))}
        </div>
        {isAdmin && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={recheck} disabled={checking}>
            {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {t('rep.recheck')}
          </Button>
        )}
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        {loading ? (
          <div className="grid gap-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : failed ? (
          <div className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <span className="text-muted-foreground min-w-0 flex-1">
              {t('rep.failed')} {errorMessage(domains.error)}
            </span>
            <Button size="sm" variant="outline" onClick={() => domains.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : shown.length === 0 ? (
          <p className="text-muted-foreground p-10 text-center text-sm">{rows.length === 0 ? t('rep.exEmpty') : t('common.noResults')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('rep.exType')}</TableHead>
                <TableHead>{t('rep.exName')}</TableHead>
                <TableHead>{t('rep.exExpires')}</TableHead>
                <TableHead className="text-right">{t('rep.exDays')}</TableHead>
                <TableHead>{t('rep.exStatus')}</TableHead>
                <TableHead>{t('rep.exIssuer')}</TableHead>
                <TableHead>{t('rep.exChecked')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <TableRow
                  key={r.key}
                  tabIndex={r.monitorId ? 0 : undefined}
                  onClick={() => r.monitorId && navigate(`/dashboard/${r.monitorId}`)}
                  onKeyDown={(e) => e.key === 'Enter' && r.monitorId && navigate(`/dashboard/${r.monitorId}`)}
                  className={cn(r.monitorId && 'cursor-pointer', 'focus-visible:bg-accent/60 outline-none')}
                >
                  <TableCell>
                    <Badge variant="outline" className="text-muted-foreground font-normal">
                      {t(r.type === 'ssl' ? 'rep.typeSsl' : 'rep.typeDomain')}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-sm font-medium">{r.name}</TableCell>
                  <TableCell className="num text-sm">{r.expires ? formatDate(r.expires) : '—'}</TableCell>
                  <TableCell
                    className={cn('num text-right text-sm font-medium', r.status === 'expired' ? 'text-down' : r.status === 'expiring' ? 'text-pending' : 'text-muted-foreground')}
                  >
                    {r.days === null ? '—' : formatNumber(r.days)}
                  </TableCell>
                  <TableCell>{pill(r.status)}</TableCell>
                  <TableCell className="text-muted-foreground max-w-48 truncate text-sm">{r.who ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground text-xs" title={r.checked ? formatDateTime(r.checked) : undefined}>
                    {r.checked ? formatRelative(r.checked) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}

/* ---------------------------------------------------------------- schedule */

const hours = Array.from({ length: 24 }, (_, h) => h)

function ScheduleTab() {
  const { t, lang } = useI18n()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['report-settings'], queryFn: api.reportSettings, staleTime: 60_000 })
  const [draft, setDraft] = useState<ReportSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState<'weekly' | 'monthly' | null>(null)
  const s = draft ?? q.data
  const weekday = (d: number) => new Intl.DateTimeFormat(lang, { weekday: 'long' }).format(new Date(2024, 0, 7 + d))

  const patch = (fn: (s: ReportSettings) => ReportSettings) => s && setDraft(fn(s))

  const save = async () => {
    if (!s) return
    setSaving(true)
    try {
      const saved = await api.saveReportSettings({ ...s, tz_offset_min: -new Date().getTimezoneOffset() })
      qc.setQueryData(['report-settings'], saved)
      setDraft(null)
      toast.success(t('rep.sch.saved'))
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }
  const send = async (p: 'weekly' | 'monthly') => {
    setSending(p)
    try {
      const { sent } = await api.sendReport(p)
      if (sent > 0) toast.success(t('rep.sch.sent', { count: sent }))
      else toast.message(t('rep.sch.sentNone'))
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSending(null)
    }
  }

  if (q.isPending)
    return (
      <Card>
        <CardContent className="grid gap-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </CardContent>
      </Card>
    )
  if (q.isError || !s)
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground min-w-0 flex-1">
            {t('rep.sch.loadFailed')} {errorMessage(q.error)}
          </span>
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>
            {t('common.retry')}
          </Button>
        </CardContent>
      </Card>
    )

  return (
    <div className="grid max-w-3xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('rep.sch.title')}</CardTitle>
          <CardDescription>{t('rep.sch.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
            <label className="flex items-center gap-3 text-sm font-medium">
              <Switch checked={s.weekly.enabled} onCheckedChange={(v) => patch((x) => ({ ...x, weekly: { ...x.weekly, enabled: v } }))} aria-label={t('rep.sch.weekly')} />
              {t('rep.sch.weekly')}
            </label>
            <select
              className={selectCls}
              aria-label={t('rep.sch.dayOfWeek')}
              disabled={!s.weekly.enabled}
              value={s.weekly.day}
              onChange={(e) => patch((x) => ({ ...x, weekly: { ...x.weekly, day: Number(e.target.value) } }))}
            >
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <option key={d} value={d}>
                  {weekday(d)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
            <label className="flex items-center gap-3 text-sm font-medium">
              <Switch checked={s.monthly.enabled} onCheckedChange={(v) => patch((x) => ({ ...x, monthly: { ...x.monthly, enabled: v } }))} aria-label={t('rep.sch.monthly')} />
              {t('rep.sch.monthly')}
            </label>
            <select
              className={selectCls}
              aria-label={t('rep.sch.dayOfMonth')}
              disabled={!s.monthly.enabled}
              value={s.monthly.day}
              onChange={(e) => patch((x) => ({ ...x, monthly: { ...x.monthly, day: Number(e.target.value) } }))}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <Field label={t('rep.sch.time')} htmlFor="rep-hour" hint={t('rep.sch.tzNote')}>
            <select id="rep-hour" className={cn(selectCls, 'w-32')} value={s.hour} onChange={(e) => patch((x) => ({ ...x, hour: Number(e.target.value) }))}>
              {hours.map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </Field>
        </CardContent>
        <CardFooter className="justify-end">
          <Button onClick={save} disabled={saving || draft === null}>
            {saving && <Loader2 className="animate-spin" />}
            {t('common.save')}
          </Button>
        </CardFooter>
      </Card>
      <div className="flex flex-wrap gap-2">
        {(['weekly', 'monthly'] as const).map((p) => (
          <Button key={p} variant="outline" onClick={() => send(p)} disabled={sending !== null}>
            {sending === p ? <Loader2 className="animate-spin" /> : <Send />}
            {t(p === 'weekly' ? 'rep.sch.sendWeekly' : 'rep.sch.sendMonthly')}
          </Button>
        ))}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- page */

export function ReportsPage() {
  const { t } = useI18n()
  const isAdmin = useIsAdmin()
  const [params, setParams] = useSearchParams()
  const tabs: { id: TabId; label: string }[] = [
    { id: 'uptime', label: t('rep.tab.uptime') },
    { id: 'expiry', label: t('rep.tab.expiry') },
    ...(isAdmin ? ([{ id: 'schedule', label: t('rep.tab.schedule') }] as { id: TabId; label: string }[]) : []),
  ]
  const requested = (params.get('tab') ?? 'uptime') as TabId
  const tab = tabs.some((x) => x.id === requested) ? requested : 'uptime'

  return (
    <div>
      <PageHeader title={t('rep.title')} description={t('rep.desc')} />
      <Tabs tabs={tabs} value={tab} onChange={(id) => setParams(id === 'uptime' ? {} : { tab: id }, { replace: true })} label={t('rep.tabs')} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0} className="min-w-0 outline-none">
        {tab === 'uptime' && <UptimeTab />}
        {tab === 'expiry' && <ExpiryTab />}
        {tab === 'schedule' && isAdmin && <ScheduleTab />}
      </div>
    </div>
  )
}
