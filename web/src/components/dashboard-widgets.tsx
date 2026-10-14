import { useMemo } from 'react'
import { Globe, Lock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { statusDot } from '@/components/status-badge'
import { useActivity } from '@/hooks/use-activity'
import { useNow } from '@/hooks/use-now'
import { useI18n } from '@/i18n'
import { describeActivity, kindStyle } from '@/lib/activity-view'
import { formatDate, formatLatency, formatRelative } from '@/lib/format'
import type { MonitorSummary } from '@/lib/types'
import { cn } from '@/lib/utils'

function WidgetCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <h2 className="px-4 pt-4 pb-2 text-sm font-semibold sm:px-5">{title}</h2>
      {children}
    </Card>
  )
}

const rowCls =
  'hover:bg-accent/50 focus-visible:bg-accent/60 flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors outline-none sm:px-5'

function Empty({ text }: { text: string }) {
  return <p className="text-muted-foreground px-5 pt-1 pb-6 text-center text-sm">{text}</p>
}

/* ---------------------------------------------------------- expiring soon */

interface ExpiryItem {
  key: string
  monitorId: number
  name: string
  kind: 'ssl' | 'domain'
  expires: number
  days: number
  status: 'ok' | 'expiring' | 'expired' | 'unknown'
}

export function ExpiringSoon({ monitors, onOpen }: { monitors: MonitorSummary[] | undefined; onOpen: (id: number) => void }) {
  const { t } = useI18n()
  const items = useMemo(() => {
    const out: ExpiryItem[] = []
    for (const m of monitors ?? []) {
      if (m.cert) out.push({ key: `s${m.id}`, monitorId: m.id, name: m.name, kind: 'ssl', expires: m.cert.expires_at, days: m.cert.days_left, status: m.cert.status })
      if (m.domain && m.domain.expires_at !== null && m.domain.days_left !== null)
        out.push({ key: `d${m.id}`, monitorId: m.id, name: m.domain.name, kind: 'domain', expires: m.domain.expires_at, days: m.domain.days_left, status: m.domain.status })
    }
    return out.sort((a, b) => a.expires - b.expires).slice(0, 8)
  }, [monitors])

  return (
    <WidgetCard title={t('widget.expiring')}>
      {!monitors ? (
        <div className="grid gap-2 px-5 pb-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : items.length === 0 ? (
        <Empty text={t('widget.expiringEmpty')} />
      ) : (
        <ul className="pb-2">
          {items.map((x) => {
            const Icon = x.kind === 'ssl' ? Lock : Globe
            return (
              <li key={x.key}>
                <button type="button" onClick={() => onOpen(x.monitorId)} className={rowCls}>
                  <Icon className="text-muted-foreground size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{x.name}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {t(x.kind === 'ssl' ? 'widget.kindSsl' : 'widget.kindDomain')} · {formatDate(x.expires)}
                    </span>
                  </span>
                  <Badge variant={x.status === 'expired' || x.days < 0 ? 'down' : x.status === 'expiring' ? 'pending' : 'muted'} className="num shrink-0">
                    {x.days < 0 ? t('widget.expired') : t('widget.daysLeft', { n: x.days })}
                  </Badge>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </WidgetCard>
  )
}

/* -------------------------------------------------------- recent incidents */

export function RecentIncidents({ onOpen }: { onOpen: (id: number) => void }) {
  const { t, lang } = useI18n()
  const now = useNow(30_000)
  const { items, isPending, isError } = useActivity()
  const list = items.slice(0, 8)
  return (
    <WidgetCard title={t('widget.incidents')}>
      {isPending ? (
        <div className="grid gap-2 px-5 pb-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : isError ? (
        <Empty text={t('widget.loadFailed')} />
      ) : list.length === 0 ? (
        <Empty text={t('widget.incidentsEmpty')} />
      ) : (
        <ul className="pb-2">
          {list.map((a) => {
            const st = kindStyle[a.kind]
            const { title, sub } = describeActivity(a, t, lang)
            return (
              <li key={a.id}>
                <button type="button" onClick={() => onOpen(a.monitor_id)} className={cn(rowCls, 'items-start')}>
                  <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full', st.cls)}>
                    <st.icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-snug font-medium [overflow-wrap:anywhere]">{title}</span>
                    {sub && <span className="text-muted-foreground mt-0.5 block text-xs [overflow-wrap:anywhere]">{sub}</span>}
                  </span>
                  <span className="text-muted-foreground shrink-0 pt-0.5 text-xs whitespace-nowrap">{formatRelative(a.t, now)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </WidgetCard>
  )
}

/* -------------------------------------------------------- slowest monitors */

export function SlowestMonitors({ monitors, onOpen }: { monitors: MonitorSummary[] | undefined; onOpen: (id: number) => void }) {
  const { t } = useI18n()
  const top = useMemo(
    () =>
      (monitors ?? [])
        .filter((m) => m.active && m.latency_ms !== null)
        .sort((a, b) => (b.latency_ms ?? 0) - (a.latency_ms ?? 0))
        .slice(0, 5),
    [monitors],
  )
  const max = Math.max(1, ...top.map((m) => m.latency_ms ?? 0))
  return (
    <WidgetCard title={t('widget.slowest')}>
      {!monitors ? (
        <div className="grid gap-2 px-5 pb-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : top.length === 0 ? (
        <Empty text={t('widget.slowestEmpty')} />
      ) : (
        <ul className="pb-2">
          {top.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => onOpen(m.id)} className={rowCls}>
                <span className={cn('size-2 shrink-0 rounded-full', statusDot[m.status])} />
                <span className="w-32 min-w-0 shrink-0 truncate text-sm font-medium sm:w-48">{m.name}</span>
                <span className="bg-muted h-1.5 min-w-0 flex-1 overflow-hidden rounded-full" aria-hidden>
                  <span className="bg-primary/60 block h-full rounded-full" style={{ width: `${Math.max(3, ((m.latency_ms ?? 0) / max) * 100)}%` }} />
                </span>
                <span className="num text-muted-foreground w-16 shrink-0 text-right text-xs">{formatLatency(m.latency_ms)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  )
}
