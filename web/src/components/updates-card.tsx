import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowUpCircle, Check, CheckCircle2, Copy, ExternalLink, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Field } from '@/components/field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useBrand } from '@/hooks/use-brand'
import { useNow } from '@/hooks/use-now'
import { BUILD_VERSION, updateKey, useApplyUpdate, useFollowServerUpdate, useUpdateInfo } from '@/hooks/use-update'
import { useI18n } from '@/i18n'
import { api, errorMessage } from '@/lib/api'
import { formatDateTime, formatRelative } from '@/lib/format'
import type { UpdateInfo } from '@/lib/types'

const DOCKER_CMD = 'docker compose pull && docker compose up -d'

/** Settings → Updates (superadmin only). Anchor: #updates */
export function UpdatesCard() {
  const { t } = useI18n()
  const { name } = useBrand()
  const qc = useQueryClient()
  const now = useNow(30_000)
  const { data: info, isPending } = useUpdateInfo()
  const { phase, target, apply, checkAgain } = useApplyUpdate()
  useFollowServerUpdate(info)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { hash } = useLocation()

  useEffect(() => {
    if (hash === '#updates' && info) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [hash, info])

  const set = (i: UpdateInfo) => qc.setQueryData(updateKey, i)

  const check = async () => {
    setChecking(true)
    try {
      set(await api.updateCheck())
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setChecking(false)
    }
  }

  const toggleAuto = async (v: boolean) => {
    setSaving(true)
    try {
      set(await api.updateSettings(v))
      toast.success(v ? t('upd.autoOn') : t('upd.autoOff'))
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(DOCKER_CMD)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  const updating = phase === 'applying' || info?.state === 'updating'

  return (
    <Card ref={ref} id="updates" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="text-base">{t('upd.title')}</CardTitle>
        <CardDescription>{t('upd.desc', { app: name })}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {isPending || !info ? (
          <div className="grid gap-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-5 w-64" />
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <div className="text-muted-foreground text-xs">{t('upd.current')}</div>
                <div className="num mt-1 text-lg font-semibold">v{info.current || BUILD_VERSION}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">{t('upd.latest')}</div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="num text-lg font-semibold">{info.latest ? `v${info.latest}` : '—'}</span>
                  {info.available && <Badge variant="up">{t('upd.available')}</Badge>}
                </div>
                {info.published_at && (
                  <div className="text-muted-foreground mt-0.5 text-xs">
                    {t('upd.published', { date: formatDateTime(info.published_at) })}
                  </div>
                )}
                {info.release_url && (
                  <a
                    href={info.release_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-muted-foreground hover:text-foreground mt-0.5 inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline"
                  >
                    {t('upd.viewRelease')}
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              <div className="flex flex-col items-start gap-1.5 sm:items-end">
                <span className="text-muted-foreground text-xs" title={info.checked_at ? formatDateTime(info.checked_at) : undefined}>
                  {info.checked_at
                    ? t('upd.lastChecked', { time: formatRelative(info.checked_at, now) })
                    : t('upd.neverChecked')}
                </span>
                <Button size="sm" variant="outline" onClick={check} disabled={checking || updating}>
                  {checking || info.state === 'checking' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  {t('upd.checkNow')}
                </Button>
              </div>
            </div>

            {/* Status / action */}
            {phase === 'timeout' ? (
              <div className="border-pending/30 bg-pending/[0.07] flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
                <TriangleAlert className="text-pending size-4 shrink-0" />
                <span className="min-w-0 flex-1">{t('upd.timeout')}</span>
                <Button size="sm" variant="outline" onClick={checkAgain}>
                  {t('upd.checkAgain')}
                </Button>
              </div>
            ) : updating ? (
              <div className="bg-muted/50 flex items-center gap-2.5 rounded-lg border p-3 text-sm" role="status">
                <Loader2 className="size-4 animate-spin" />
                {t('upd.updating', { v: target ?? info.latest ?? '' })}
              </div>
            ) : info.available ? (
              info.can_apply && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={apply}>
                    <ArrowUpCircle />
                    {t('upd.now')}
                  </Button>
                </div>
              )
            ) : (
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <CheckCircle2 className="text-up size-4" />
                {t('upd.upToDate')}
              </div>
            )}

            {info.state === 'error' && info.error && (
              <p className="text-destructive bg-destructive/10 rounded-lg px-3 py-2 text-sm">
                {t('upd.error', { error: info.error })}
              </p>
            )}

            {info.mode === 'docker' && (
              <div className="grid gap-2">
                <p className="text-muted-foreground text-sm">{t('upd.dockerHelp')}</p>
                <div className="bg-muted/60 flex items-center gap-2 rounded-lg border py-1.5 pr-1.5 pl-3">
                  <code className="min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-nowrap">{DOCKER_CMD}</code>
                  <Button size="icon-sm" variant="ghost" onClick={copy} aria-label={t('upd.copy')} title={t('upd.copy')}>
                    {copied ? <Check className="text-up" /> : <Copy />}
                  </Button>
                </div>
              </div>
            )}
            {info.mode === 'manual' && <p className="text-muted-foreground text-sm">{t('upd.manualHelp')}</p>}

            {info.available && info.notes && (
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">{t('upd.notes')}</span>
                <div className="bg-muted/40 scrollbar-thin max-h-56 overflow-y-auto rounded-lg border p-3 text-[13px] leading-relaxed whitespace-pre-wrap">
                  {info.notes}
                </div>
              </div>
            )}

            <Field label={t('upd.auto')} hint={t('upd.autoHelp')} className="gap-2">
              <div className="flex items-center gap-3">
                <Switch
                  checked={info.auto_update}
                  onCheckedChange={toggleAuto}
                  disabled={saving || !info.can_apply}
                  aria-label={t('upd.auto')}
                />
                {saving && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
              </div>
            </Field>

            {info.last_result && (
              <p className={info.last_result.ok ? 'text-muted-foreground text-xs' : 'text-destructive text-xs'}>
                {info.last_result.ok
                  ? t('upd.lastOk', { v: info.last_result.version, date: formatDateTime(info.last_result.at) })
                  : t('upd.lastFail', { error: info.last_result.error ?? '—' })}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
