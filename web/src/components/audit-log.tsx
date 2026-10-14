import { Fragment, useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useNow } from '@/hooks/use-now'
import { translateDynamic, useI18n } from '@/i18n'
import { api, errorMessage } from '@/lib/api'
import { formatDateTime, formatRelative } from '@/lib/format'
import type { AuditEntry } from '@/lib/types'
import { cn } from '@/lib/utils'

const GROUPS = [
  { id: 'all', key: 'audit.gAll', prefixes: [] as string[] },
  { id: 'auth', key: 'audit.gAuth', prefixes: ['auth.'] },
  { id: 'monitors', key: 'audit.gMonitors', prefixes: ['monitor.'] },
  { id: 'groups', key: 'audit.gGroups', prefixes: ['group.'] },
  { id: 'users', key: 'audit.gUsers', prefixes: ['user.'] },
  { id: 'notifications', key: 'audit.gNotifications', prefixes: ['notification.'] },
  { id: 'maintenance', key: 'audit.gMaintenance', prefixes: ['maintenance.', 'telegram.'] },
  { id: 'settings', key: 'audit.gSettings', prefixes: ['settings.', 'update.'] },
] as const

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

function Row({ e, now, open, onToggle }: { e: AuditEntry; now: number; open: boolean; onToggle: () => void }) {
  const { t } = useI18n()
  const label = translateDynamic(`audit.a.${e.action}`) ?? e.action
  const failed = e.action === 'auth.login_failed'
  const hasDetails = !!e.details && Object.keys(e.details).length > 0
  const target = e.target_name ?? (e.target_id != null ? `#${e.target_id}` : null)
  return (
    <Fragment>
      <TableRow className={cn(failed && 'bg-down/[0.04]')}>
        <TableCell className="text-muted-foreground w-0 pr-0">
          {hasDetails && (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              aria-label={t('audit.details')}
              className="hover:text-foreground focus-visible:ring-ring/50 rounded outline-none focus-visible:ring-2"
            >
              <ChevronRight className={cn('size-4 transition-transform duration-150', open && 'rotate-90')} />
            </button>
          )}
        </TableCell>
        <TableCell title={formatDateTime(e.t)} className="text-muted-foreground text-xs">
          {formatRelative(e.t, now)}
        </TableCell>
        <TableCell className="max-w-40 truncate text-sm">{e.username ?? <span className="text-muted-foreground">{t('audit.system')}</span>}</TableCell>
        <TableCell className={cn('text-sm font-medium', failed && 'text-down')}>
          <span title={e.action}>{label}</span>
        </TableCell>
        <TableCell className="max-w-56 truncate text-sm">
          {target ? (
            <>
              {e.target_type && <span className="text-muted-foreground mr-1.5 text-xs">{e.target_type}</span>}
              {target}
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="num text-muted-foreground text-xs">{e.ip ?? '—'}</TableCell>
      </TableRow>
      {open && hasDetails && (
        <TableRow className="hover:bg-transparent">
          <TableCell />
          <TableCell colSpan={5} className="whitespace-normal">
            <pre className="bg-muted/50 scrollbar-thin max-h-60 overflow-auto rounded-md border p-3 font-mono text-xs [overflow-wrap:anywhere] whitespace-pre-wrap">
              {JSON.stringify(e.details, null, 2)}
            </pre>
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  )
}

/** Settings → Audit log (superadmin). */
export function AuditLog() {
  const { t } = useI18n()
  const now = useNow(30_000)
  const [userText, setUserText] = useState('')
  const [group, setGroup] = useState<(typeof GROUPS)[number]['id']>('all')
  const [openIds, setOpenIds] = useState<Set<number>>(new Set())
  const user = useDebounced(userText.trim(), 300)
  const g = GROUPS.find((x) => x.id === group)!
  const serverPrefix = g.prefixes.length === 1 ? g.prefixes[0] : undefined

  const q = useInfiniteQuery({
    queryKey: ['audit', user, serverPrefix ?? ''],
    queryFn: ({ pageParam }) => api.audit({ limit: 50, before: pageParam, user: user || undefined, action: serverPrefix }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.next_before,
  })

  const items = useMemo(() => {
    const all = q.data?.pages.flatMap((p) => p.items) ?? []
    // Groups with several prefixes are filtered here (the API takes a single prefix).
    return g.prefixes.length > 1 ? all.filter((e) => g.prefixes.some((p) => e.action.startsWith(p))) : all
  }, [q.data, g])

  const toggle = (id: number) =>
    setOpenIds((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-base">{t('audit.title')}</CardTitle>
        <CardDescription>{t('audit.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4 [&>*]:min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={userText}
            onChange={(e) => setUserText(e.target.value)}
            placeholder={t('audit.userFilter')}
            aria-label={t('audit.userFilter')}
            className="h-9 w-full sm:w-56"
          />
          <select
            value={group}
            onChange={(e) => setGroup(e.target.value as typeof group)}
            aria-label={t('audit.actionFilter')}
            className="border-input bg-card dark:bg-input/20 focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-lg border px-2.5 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
          >
            {GROUPS.map((x) => (
              <option key={x.id} value={x.id}>
                {t(x.key)}
              </option>
            ))}
          </select>
        </div>

        {q.isPending ? (
          <div className="grid gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : q.isError ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground min-w-0 flex-1">
              {t('audit.failed')} {errorMessage(q.error)}
            </span>
            <Button size="sm" variant="outline" onClick={() => q.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">{t('audit.empty')}</p>
        ) : (
          <div className="-mx-2 min-w-0 overflow-x-auto sm:mx-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-0" />
                  <TableHead>{t('audit.colTime')}</TableHead>
                  <TableHead>{t('audit.colUser')}</TableHead>
                  <TableHead>{t('audit.colAction')}</TableHead>
                  <TableHead>{t('audit.colTarget')}</TableHead>
                  <TableHead>{t('audit.colIp')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((e) => (
                  <Row key={e.id} e={e} now={now} open={openIds.has(e.id)} onToggle={() => toggle(e.id)} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {q.hasNextPage && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
              {q.isFetchingNextPage && <Loader2 className="animate-spin" />}
              {t('audit.loadMore')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
