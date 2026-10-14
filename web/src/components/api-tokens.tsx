import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ExternalLink, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import { Field } from '@/components/field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useNow } from '@/hooks/use-now'
import { useI18n } from '@/i18n'
import { api, errorMessage } from '@/lib/api'
import { formatDate, formatDateTime, formatRelative } from '@/lib/format'

const DOCS_URL = 'https://github.com/mdenizay/observi/blob/main/docs/API.md'
const EXPIRIES = ['30', '90', '365', 'never'] as const

function CreateDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'read' | 'write'>('read')
  const [expiry, setExpiry] = useState<(typeof EXPIRIES)[number]>('90')
  const [nameError, setNameError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setNameError(t('common.nameRequired'))
    setBusy(true)
    try {
      const res = await api.createToken({ name: name.trim(), scope, ...(expiry === 'never' ? {} : { expires_days: Number(expiry) }) })
      setToken(res.token)
      qc.invalidateQueries({ queryKey: ['tokens'] })
      qc.invalidateQueries({ queryKey: ['security'] })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        {token ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('tokens.createdTitle')}</DialogTitle>
              <DialogDescription>{t('tokens.createdDesc')}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="flex gap-2">
                <Input readOnly aria-label={t('tokens.token')} value={token} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} autoFocus />
                <CopyButton text={token} />
              </div>
              <p className="text-pending bg-pending/10 flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {t('tokens.warning')}
              </p>
            </div>
            <DialogFooter>
              <Button onClick={onClose}>{t('common.done')}</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t('tokens.createTitle')}</DialogTitle>
              <DialogDescription>{t('tokens.createDesc')}</DialogDescription>
            </DialogHeader>
            <Field label={t('common.name')} htmlFor="tok-name" error={nameError}>
              <Input
                id="tok-name"
                autoFocus
                maxLength={60}
                placeholder={t('tokens.namePlaceholder')}
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setNameError(null)
                }}
                aria-invalid={!!nameError}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('tokens.access')} htmlFor="tok-scope">
                <Select value={scope} onValueChange={(v) => setScope(v as 'read' | 'write')}>
                  <SelectTrigger id="tok-scope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read">{t('tokens.read')}</SelectItem>
                    <SelectItem value="write">{t('tokens.write')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t('tokens.expiry')} htmlFor="tok-exp">
                <Select value={expiry} onValueChange={(v) => setExpiry(v as typeof expiry)}>
                  <SelectTrigger id="tok-exp">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRIES.map((e) => (
                      <SelectItem key={e} value={e}>
                        {t(`tokens.exp.${e}` as const)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                {t('tokens.create')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function ApiTokens() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const now = useNow(60_000)
  const q = useQuery({ queryKey: ['tokens'], queryFn: api.tokens })
  const [creating, setCreating] = useState(false)
  const [toRevoke, setToRevoke] = useState<{ id: number; name: string } | null>(null)
  const items = q.data?.items ?? []
  const curl = `curl -H "Authorization: Bearer obs_…" ${window.location.origin}/api/monitors`

  return (
    <div className="grid gap-4 [&>*]:min-w-0">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('tokens.introTitle')}</CardTitle>
          <CardDescription>{t('tokens.intro')}</CardDescription>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <pre className="bg-muted/50 min-w-0 flex-1 overflow-x-auto rounded-lg border px-3 py-2.5 font-mono text-xs leading-relaxed">{curl}</pre>
            <CopyButton text={curl} iconOnly variant="ghost" />
          </div>
          <a href={DOCS_URL} target="_blank" rel="noreferrer noopener" className="text-primary inline-flex w-fit items-center gap-1.5 text-sm underline-offset-4 hover:underline">
            {t('tokens.docs')}
            <ExternalLink className="size-3.5" />
          </a>
        </CardContent>
      </Card>

      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex items-center justify-between gap-3 border-b px-6 py-4">
          <div>
            <h3 className="text-base leading-none font-semibold">{t('tokens.title')}</h3>
            <p className="text-muted-foreground mt-1.5 text-sm">{t('tokens.desc')}</p>
          </div>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            {t('tokens.create')}
          </Button>
        </div>
        {q.isPending ? (
          <div className="p-4">
            <Skeleton className="h-12 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground p-8 text-center text-sm">{t('tokens.empty')}</p>
        ) : (
          <ul className="divide-y">
            {items.map((tk) => (
              <li key={tk.id} className="flex items-center gap-3 px-6 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-sm font-medium">{tk.name}</span>
                    <Badge variant={tk.scope === 'write' ? 'pending' : 'muted'}>{tk.scope === 'write' ? t('tokens.write') : t('tokens.read')}</Badge>
                    <code className="text-muted-foreground font-mono text-xs">{tk.prefix}…</code>
                  </div>
                  <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 text-xs">
                    <span title={formatDateTime(tk.created_at)}>{t('tokens.created', { when: formatRelative(tk.created_at, now) })}</span>
                    <span title={tk.last_used_at ? formatDateTime(tk.last_used_at) : undefined}>
                      {tk.last_used_at ? t('tokens.lastUsed', { when: formatRelative(tk.last_used_at, now) }) : t('tokens.neverUsed')}
                    </span>
                    <span>{tk.expires_at ? t('tokens.expires', { date: formatDate(tk.expires_at) }) : t('tokens.neverExpires')}</span>
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setToRevoke(tk)}>
                  <Trash2 />
                  {t('tokens.revoke')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {creating && <CreateDialog onClose={() => setCreating(false)} />}
      <ConfirmDialog
        open={!!toRevoke}
        onOpenChange={(o) => !o && setToRevoke(null)}
        title={t('tokens.revokeTitle')}
        description={t('tokens.revokeDesc', { name: toRevoke?.name ?? '' })}
        confirmLabel={t('tokens.revoke')}
        onConfirm={async () => {
          if (!toRevoke) return
          try {
            await api.deleteToken(toRevoke.id)
            toast.success(t('tokens.revoked'))
            qc.invalidateQueries({ queryKey: ['tokens'] })
            qc.invalidateQueries({ queryKey: ['security'] })
          } catch (err) {
            toast.error(errorMessage(err))
            throw err
          }
        }}
      />
    </div>
  )
}
