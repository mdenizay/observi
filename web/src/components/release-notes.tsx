import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { Markdown } from '@/components/markdown'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { releasesKey } from '@/hooks/use-update'
import { useI18n } from '@/i18n'
import { api, errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import type { ReleaseInfo } from '@/lib/types'
import { cn } from '@/lib/utils'

function Notes({ r }: { r: ReleaseInfo }) {
  const { t } = useI18n()
  return (
    <div className="grid gap-3">
      {r.notes?.trim() ? <Markdown text={r.notes} /> : <p className="text-muted-foreground text-sm">{t('upd.noNotes')}</p>}
      <a
        href={r.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-xs underline-offset-4 hover:underline"
      >
        {t('upd.viewOnGithub')}
        <ExternalLink className="size-3" />
      </a>
    </div>
  )
}

function HistoryRow({ r, defaultOpen }: { r: ReleaseInfo; defaultOpen: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(defaultOpen)
  const id = `rel-${r.version}`
  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-accent/40 focus-visible:ring-ring/50 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
      >
        <ChevronRight className={cn('text-muted-foreground size-4 shrink-0 transition-transform duration-150', open && 'rotate-90')} />
        <span className="num text-sm font-medium">v{r.version}</span>
        {r.is_current && <Badge variant="secondary">{t('upd.badgeCurrent')}</Badge>}
        {r.is_newer && <Badge variant="up">{t('upd.badgeNew')}</Badge>}
        <span className="text-muted-foreground ml-auto text-xs">{r.published_at ? formatDate(r.published_at) : ''}</span>
      </button>
      {open && (
        <div id={id} className="px-4 pb-4 pl-11">
          <Notes r={r} />
        </div>
      )}
    </div>
  )
}

/** Release notes: the current version's "What's new" plus a collapsible history. */
export function ReleaseNotes() {
  const { t } = useI18n()
  const q = useQuery({ queryKey: releasesKey, queryFn: () => api.releases(false), staleTime: 10 * 60_000 })

  if (q.isPending)
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('upd.notes')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    )
  if (q.isError)
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('upd.notes')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground min-w-0 flex-1">
            {t('upd.releasesFailed')} {errorMessage(q.error)}
          </span>
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>
            {t('common.retry')}
          </Button>
        </CardContent>
      </Card>
    )

  const releases = q.data.releases
  const current = releases.find((r) => r.is_current)
  const newerFirst = [...releases].sort((a, b) => Number(b.is_newer) - Number(a.is_newer))
  const firstNewer = releases.find((r) => r.is_newer)

  return (
    <div className="grid gap-4">
      {current && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('upd.whatsNew', { v: current.version })}</CardTitle>
            {current.published_at && (
              <p className="text-muted-foreground text-xs">{t('upd.published', { date: formatDate(current.published_at) })}</p>
            )}
          </CardHeader>
          <CardContent>
            <Notes r={current} />
          </CardContent>
        </Card>
      )}
      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-4">
          <CardTitle className="text-base">{t('upd.history')}</CardTitle>
        </CardHeader>
        {releases.length === 0 ? (
          <p className="text-muted-foreground p-4 text-sm">{t('upd.noNotes')}</p>
        ) : (
          newerFirst.map((r) => <HistoryRow key={r.version} r={r} defaultOpen={r === firstNewer} />)
        )}
      </Card>
    </div>
  )
}
