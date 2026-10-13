import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Send } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app-shell'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { ListCard, ListRow, ListSearch, ListSkeleton, RowActions } from '@/components/list-kit'
import { formatNumber } from '@/lib/format'
import { Field, SwitchField } from '@/components/field'
import { kindIcon, kindKinds, kindLabel } from '@/components/kind-icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, errorMessage } from '@/lib/api'
import type {
  Notification,
  NotificationInput,
  NotificationKind,
  SmtpCfg,
  TelegramCfg,
  WebhookCfg,
} from '@/lib/types'
import { richText, translate, useI18n, type Key, type Params } from '@/i18n'

interface Cfg {
  bot_token: string
  chat_id: string
  host: string
  port: string
  security: SmtpCfg['security']
  username: string
  password: string
  from: string
  to: string
  url: string
  format: WebhookCfg['format']
}

const emptyCfg: Cfg = {
  bot_token: '',
  chat_id: '',
  host: '',
  port: '587',
  security: 'starttls',
  username: '',
  password: '',
  from: '',
  to: '',
  url: '',
  format: 'json',
}

function cfgFrom(n: Notification | null): Cfg {
  if (!n) return emptyCfg
  const c = n.config as Partial<TelegramCfg & SmtpCfg & WebhookCfg>
  return {
    ...emptyCfg,
    bot_token: c.bot_token ?? '',
    chat_id: c.chat_id ?? '',
    host: c.host ?? '',
    port: c.port != null ? String(c.port) : emptyCfg.port,
    security: c.security ?? 'starttls',
    username: c.username ?? '',
    password: c.password ?? '',
    from: c.from ?? '',
    to: c.to ?? '',
    url: c.url ?? '',
    format: c.format ?? 'json',
  }
}

function buildConfig(kind: NotificationKind, c: Cfg): NotificationInput['config'] {
  switch (kind) {
    case 'telegram':
      return { bot_token: c.bot_token.trim(), chat_id: c.chat_id.trim() }
    case 'smtp': {
      const cfg: SmtpCfg = {
        host: c.host.trim(),
        port: Number(c.port),
        security: c.security,
        from: c.from.trim(),
        to: c.to.trim(),
      }
      if (c.username.trim()) cfg.username = c.username.trim()
      if (c.password) cfg.password = c.password
      return cfg
    }
    case 'webhook':
      return { url: c.url.trim(), format: c.format }
  }
}

function validate(name: string, kind: NotificationKind, c: Cfg) {
  const t = translate
  const e: Record<string, string> = {}
  if (!name.trim()) e.name = t('common.nameRequired')
  if (kind === 'telegram') {
    if (!c.bot_token.trim()) e.bot_token = t('notif.v.botToken')
    if (!c.chat_id.trim()) e.chat_id = t('notif.v.chatId')
  } else if (kind === 'smtp') {
    if (!c.host.trim()) e.host = t('notif.v.host')
    const p = Number(c.port)
    if (!/^\d+$/.test(c.port) || p < 1 || p > 65535) e.port = t('notif.v.port')
    if (!c.from.trim()) e.from = t('notif.v.from')
    if (!c.to.trim()) e.to = t('notif.v.to')
  } else {
    try {
      const u = new URL(c.url.trim())
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error()
    } catch {
      e.url = t('common.invalidUrl')
    }
  }
  return e
}

function NotificationDialog({
  open,
  onOpenChange,
  item,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  item: Notification | null
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [name, setName] = useState(item?.name ?? '')
  const [kind, setKind] = useState<NotificationKind>(item?.kind ?? 'telegram')
  const [cfg, setCfg] = useState<Cfg>(() => cfgFrom(item))
  const [isDefault, setIsDefault] = useState(item?.is_default ?? false)
  const [applyExisting, setApplyExisting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const setC = <K extends keyof Cfg>(k: K, v: Cfg[K]) => {
    setCfg((c) => ({ ...c, [k]: v }))
    if (errors[k]) setErrors((e) => ({ ...e, [k]: '' }))
  }

  const input = (): NotificationInput | null => {
    const errs = validate(name, kind, cfg)
    setErrors(errs)
    if (Object.keys(errs).length) return null
    return {
      name: name.trim(),
      kind,
      is_default: isDefault,
      apply_existing: applyExisting,
      config: buildConfig(kind, cfg),
    }
  }

  const test = async () => {
    const body = input()
    if (!body) return
    setTesting(true)
    try {
      await api.testNotification(body)
      toast.success(t('notif.testSent'))
    } catch (e) {
      toast.error(t('notif.testFailed', { error: errorMessage(e) }))
    } finally {
      setTesting(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const body = input()
    if (!body) return
    setSaving(true)
    try {
      if (item) await api.updateNotification(item.id, body)
      else await api.createNotification(body)
      toast.success(item ? t('notif.updated') : t('notif.created'))
      await qc.invalidateQueries({ queryKey: ['notifications'] })
      if (applyExisting) qc.invalidateQueries({ queryKey: ['monitor'] })
      onOpenChange(false)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const text = (k: keyof Cfg, label: string, props: React.ComponentProps<typeof Input> = {}, hint?: string) => (
    <Field label={label} htmlFor={`c-${k}`} error={errors[k]} hint={hint}>
      <Input
        id={`c-${k}`}
        value={cfg[k] as string}
        onChange={(e) => setC(k, e.target.value as never)}
        aria-invalid={!!errors[k]}
        {...props}
      />
    </Field>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? t('notif.editTitle') : t('notif.new')}</DialogTitle>
          <DialogDescription>{t('notif.dialogDesc')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('notif.type')} htmlFor="n-kind">
              <Select value={kind} onValueChange={(v) => setKind(v as NotificationKind)}>
                <SelectTrigger id="n-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kindKinds.map((k) => {
                    const Icon = kindIcon[k]
                    return (
                      <SelectItem key={k} value={k}>
                        <Icon />
                        {kindLabel(k)}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('common.name')} htmlFor="n-name" error={errors.name}>
              <Input
                id="n-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  if (errors.name) setErrors((x) => ({ ...x, name: '' }))
                }}
                placeholder={t('notif.namePlaceholder')}
                aria-invalid={!!errors.name}
              />
            </Field>
          </div>

          {kind === 'telegram' && (
            <div className="grid gap-4 sm:grid-cols-2">
              {text('bot_token', t('notif.botToken'), { autoComplete: 'off', placeholder: '123456:ABC-DEF…' }, t('notif.botTokenHint'))}
              {text('chat_id', t('notif.chatId'), { placeholder: '-1001234567890' })}
            </div>
          )}

          {kind === 'smtp' && (
            <div className="grid gap-4 sm:grid-cols-6">
              <div className="sm:col-span-4">{text('host', t('notif.smtpHost'), { placeholder: t('notif.smtpHostPlaceholder') })}</div>
              <div className="sm:col-span-2">{text('port', t('notif.port'), { inputMode: 'numeric' })}</div>
              <Field label={t('notif.security')} htmlFor="c-security" className="sm:col-span-6">
                <Select value={cfg.security} onValueChange={(v) => setC('security', v as SmtpCfg['security'])}>
                  <SelectTrigger id="c-security">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="starttls">STARTTLS</SelectItem>
                    <SelectItem value="tls">TLS / SSL</SelectItem>
                    <SelectItem value="none">{t('notif.secNone')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <div className="sm:col-span-3">
                {text('username', t('notif.username'), { autoComplete: 'off', placeholder: t('common.optional') })}
              </div>
              <div className="sm:col-span-3">
                {text('password', t('notif.password'), { type: 'password', autoComplete: 'new-password', placeholder: t('common.optional') })}
              </div>
              <div className="sm:col-span-3">
                {text('from', t('notif.from'), { type: 'email', placeholder: t('notif.fromPlaceholder') })}
              </div>
              <div className="sm:col-span-3">
                {text('to', t('notif.to'), { placeholder: t('notif.toPlaceholder') }, t('notif.toHint'))}
              </div>
            </div>
          )}

          {kind === 'webhook' && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                {text('url', t('notif.webhookUrl'), { type: 'url', placeholder: 'https://…' })}
              </div>
              <Field label={t('notif.format')} htmlFor="c-format">
                <Select value={cfg.format} onValueChange={(v) => setC('format', v as WebhookCfg['format'])}>
                  <SelectTrigger id="c-format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="discord">Discord</SelectItem>
                    <SelectItem value="slack">Slack</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          )}

          <div className="grid gap-2">
            <SwitchField
              id="n-default"
              label={t('notif.isDefault')}
              checked={isDefault}
              onCheckedChange={setIsDefault}
            />
            <SwitchField
              id="n-apply"
              label={t('notif.applyExisting')}
              description={t('notif.applyExistingDesc')}
              checked={applyExisting}
              onCheckedChange={setApplyExisting}
            />
          </div>

          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="outline" onClick={test} disabled={testing || saving}>
              {testing ? <Loader2 className="animate-spin" /> : <Send />}
              {t('notif.test')}
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="animate-spin" />}
                {item ? t('common.save') : t('common.create')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function summary(n: Notification, t: (key: Key, params?: Params) => string) {
  const c = n.config as Partial<TelegramCfg & SmtpCfg & WebhookCfg>
  if (n.kind === 'telegram') return c.chat_id ? t('notif.chatSummary', { id: c.chat_id }) : ''
  if (n.kind === 'smtp') return [c.to, c.host].filter(Boolean).join(' · ')
  if (c.url) {
    try {
      return `${new URL(c.url).host} · ${(c.format ?? 'json').toUpperCase()}`
    } catch {
      return c.url
    }
  }
  return ''
}

export function NotificationsPage() {
  const { t, lang } = useI18n()
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['notifications'], queryFn: api.notifications })
  const [q, setQ] = useState('')
  const [dialog, setDialog] = useState<{ open: boolean; item: Notification | null; key: number }>({
    open: false,
    item: null,
    key: 0,
  })
  const [toDelete, setToDelete] = useState<Notification | null>(null)
  const openDialog = (item: Notification | null) => setDialog((d) => ({ open: true, item, key: d.key + 1 }))

  const shown = useMemo(() => {
    const term = q.trim().toLocaleLowerCase(lang)
    return (list.data ?? []).filter((n) => !term || n.name.toLocaleLowerCase(lang).includes(term))
  }, [list.data, q, lang])

  return (
    <div>
      <PageHeader
        title={t('notif.title')}
        count={list.data ? formatNumber(list.data.length) : undefined}
        description={t('notif.desc')}
        actions={
          <Button onClick={() => openDialog(null)}>
            <Plus />
            {t('notif.new')}
          </Button>
        }
      />
      <div className="mb-3">
        <ListSearch value={q} onChange={setQ} />
      </div>

      {list.isPending ? (
        <ListSkeleton />
      ) : list.isError ? (
        <ListCard>
          <p className="text-muted-foreground p-8 text-center text-sm">{errorMessage(list.error)}</p>
        </ListCard>
      ) : !list.data.length ? (
        <ListCard>
          <EmptyState
            kind="notifications"
            title={t('notif.empty')}
            description={t('notif.desc')}
            action={
              <Button size="sm" variant="outline" onClick={() => openDialog(null)}>
                <Plus />
                {t('notif.add')}
              </Button>
            }
          />
        </ListCard>
      ) : shown.length === 0 ? (
        <ListCard>
          <EmptyState kind="search" title={t('common.noResults')} />
        </ListCard>
      ) : (
        <ListCard>
          {shown.map((n) => {
            const Icon = kindIcon[n.kind] ?? Send
            const sum = summary(n, t)
            return (
              <ListRow
                key={n.id}
                onClick={() => openDialog(n)}
                leading={
                  <div className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg border">
                    <Icon className="size-4" />
                  </div>
                }
                title={
                  <>
                    <span className="truncate">{n.name}</span>
                    {n.is_default && <Badge variant="secondary">{t('common.default')}</Badge>}
                  </>
                }
                subtitle={sum ? `${kindLabel(n.kind)} — ${sum}` : kindLabel(n.kind)}
                actions={<RowActions onEdit={() => openDialog(n)} onDelete={() => setToDelete(n)} />}
              />
            )
          })}
        </ListCard>
      )}

      <NotificationDialog
        key={dialog.key}
        open={dialog.open}
        item={dialog.item}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t('notif.deleteTitle')}
        description={richText(t('notif.deleteDesc'), {
          name: <strong className="text-foreground">{toDelete?.name}</strong>,
        })}
        onConfirm={async () => {
          if (!toDelete) return
          try {
            await api.deleteNotification(toDelete.id)
            toast.success(t('notif.deleted'))
            qc.invalidateQueries({ queryKey: ['notifications'] })
          } catch (e) {
            toast.error(errorMessage(e))
            throw e
          }
        }}
      />
    </div>
  )
}
