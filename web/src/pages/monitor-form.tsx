import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, Globe, Loader2, Network, TextSearch, Webhook } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app-shell'
import { Field, SwitchField } from '@/components/field'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'
import type { Monitor, MonitorInput, MonitorType } from '@/lib/types'
import { kindIcon } from '@/components/kind-icon'
import { GroupCombobox } from '@/components/group-combobox'
import { TagsInput } from '@/components/tags'
import { TemplatePicker } from '@/components/template-picker'
import { applyPath, applyTemplate, type MonitorTemplate } from '@/lib/templates'
import { cn } from '@/lib/utils'
import { translate, useI18n } from '@/i18n'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export interface FormState {
  type: MonitorType
  name: string
  url: string
  method: string
  keyword: string
  invert_keyword: boolean
  hostname: string
  port: string
  interval: string
  retry_interval: string
  max_retries: string
  timeout: string
  accepted_status: string
  ignore_tls: boolean
  upside_down: boolean
  max_redirects: string
  headers: string
  body: string
  description: string
  group_id: string // '' = grupsuz
  tags: string[]
  notification_ids: number[]
}

const NO_GROUP = 'none'

const typeOptions = [
  { value: 'http', icon: Globe, label: 'mf.typeHttpShort', desc: 'mf.typeHttpDesc' },
  { value: 'keyword', icon: TextSearch, label: 'mf.typeKeywordShort', desc: 'mf.typeKeywordDesc' },
  { value: 'tcp', icon: Network, label: 'mf.typeTcpShort', desc: 'mf.typeTcpDesc' },
] as const

const defaults: FormState = {
  type: 'http',
  name: '',
  url: 'https://',
  method: 'GET',
  keyword: '',
  invert_keyword: false,
  hostname: '',
  port: '',
  interval: '60',
  retry_interval: '60',
  max_retries: '2',
  timeout: '30',
  accepted_status: '200-299',
  ignore_tls: false,
  upside_down: false,
  max_redirects: '10',
  headers: '',
  body: '',
  description: '',
  group_id: NO_GROUP,
  tags: [],
  notification_ids: [],
}

function fromMonitor(m: Monitor): FormState {
  return {
    type: m.type,
    name: m.name,
    url: m.url ?? '',
    method: m.method || 'GET',
    keyword: m.keyword ?? '',
    invert_keyword: !!m.invert_keyword,
    hostname: m.hostname ?? '',
    port: m.port != null ? String(m.port) : '',
    interval: String(m.interval ?? 60),
    retry_interval: String(m.retry_interval ?? 60),
    max_retries: String(m.max_retries ?? 2),
    timeout: String(m.timeout ?? 30),
    accepted_status: m.accepted_status || '200-299',
    ignore_tls: !!m.ignore_tls,
    upside_down: !!m.upside_down,
    max_redirects: String(m.max_redirects ?? 10),
    headers: m.headers ?? '',
    body: m.body ?? '',
    description: m.description ?? '',
    group_id: m.group_id != null ? String(m.group_id) : NO_GROUP,
    tags: m.tags ?? [],
    notification_ids: m.notification_ids ?? [],
  }
}

type Errors = Partial<Record<keyof FormState, string>>

const isInt = (v: string) => /^\d+$/.test(v.trim())

function validate(f: FormState): Errors {
  const t = translate
  const e: Errors = {}
  if (!f.name.trim()) e.name = t('common.nameRequired')
  if (f.type === 'tcp') {
    if (!f.hostname.trim()) e.hostname = t('mf.v.hostRequired')
    const p = Number(f.port)
    if (!isInt(f.port) || p < 1 || p > 65535) e.port = t('mf.v.port')
  } else {
    try {
      const u = new URL(f.url.trim())
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error()
    } catch {
      e.url = t('common.invalidUrl')
    }
    if (f.type === 'keyword' && !f.keyword.trim()) e.keyword = t('mf.v.keyword')
    if (!/^\s*\d{3}(\s*-\s*\d{3})?(\s*,\s*\d{3}(\s*-\s*\d{3})?)*\s*$/.test(f.accepted_status))
      e.accepted_status = t('mf.v.acceptedStatus')
    if (!isInt(f.max_redirects)) e.max_redirects = t('mf.v.number')
    if (f.headers.trim()) {
      try {
        const h = JSON.parse(f.headers)
        if (!h || typeof h !== 'object' || Array.isArray(h)) throw new Error()
      } catch {
        e.headers = t('mf.v.headers')
      }
    }
  }
  if (!isInt(f.interval) || Number(f.interval) < 20) e.interval = t('mf.v.interval')
  if (!isInt(f.retry_interval) || Number(f.retry_interval) < 1) e.retry_interval = t('mf.v.duration')
  if (!isInt(f.max_retries)) e.max_retries = t('mf.v.number')
  if (!isInt(f.timeout) || Number(f.timeout) < 1) e.timeout = t('mf.v.duration')
  return e
}

function toInput(f: FormState): MonitorInput {
  const base: MonitorInput = {
    name: f.name.trim(),
    type: f.type,
    interval: Number(f.interval),
    retry_interval: Number(f.retry_interval),
    max_retries: Number(f.max_retries),
    timeout: Number(f.timeout),
    accepted_status: f.accepted_status.replace(/\s+/g, ''),
    ignore_tls: f.ignore_tls,
    upside_down: f.upside_down,
    max_redirects: Number(f.max_redirects) || 0,
    headers: null,
    body: null,
    description: f.description.trim() || null,
    group_id: f.group_id === NO_GROUP ? null : Number(f.group_id),
    tags: f.tags,
    notification_ids: f.notification_ids,
  }
  if (f.type === 'tcp') {
    base.hostname = f.hostname.trim()
    base.port = Number(f.port)
  } else {
    base.url = f.url.trim()
    base.method = f.method
    base.headers = f.headers.trim() || null
    base.body = f.body.trim() ? f.body : null
    if (f.type === 'keyword') {
      base.keyword = f.keyword
      base.invert_keyword = f.invert_keyword
    }
  }
  return base
}

export function MonitorFormPage() {
  const { t } = useI18n()
  const { id } = useParams()
  const editId = id ? Number(id) : null
  const isEdit = editId !== null
  const navigate = useNavigate()
  const qc = useQueryClient()

  const monitor = useQuery({
    queryKey: ['monitor', editId],
    queryFn: () => api.monitor(editId!),
    enabled: isEdit,
  })
  const notifications = useQuery({ queryKey: ['notifications'], queryFn: api.notifications })

  const [form, setForm] = useState<FormState>(defaults)
  const [errors, setErrors] = useState<Errors>({})
  const [loaded, setLoaded] = useState(!isEdit)
  const [defaultsApplied, setDefaultsApplied] = useState(isEdit)
  const [advanced, setAdvanced] = useState(false)
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [pendingPath, setPendingPath] = useState<string | null>(null)
  const [appliedPath, setAppliedPath] = useState<string | null>(null)

  const pickTemplate = (tpl: MonitorTemplate | null) => {
    setTemplateId(tpl?.id ?? null)
    if (!tpl) {
      setPendingPath(null)
      setAppliedPath(null)
      return
    }
    const before = form.url
    const r = applyTemplate(form, tpl)
    setForm(r.form)
    setPendingPath(r.pendingPath)
    setAppliedPath(!r.pendingPath && tpl.path && r.form.url !== before ? tpl.path : null)
    if (r.form.headers) setAdvanced(true)
    toast.success(t('tpl.applied', { name: t(tpl.name) }))
  }
  const [saving, setSaving] = useState(false)

  // Populate when editing.
  useEffect(() => {
    if (isEdit && monitor.data && !loaded) {
      const f = fromMonitor(monitor.data)
      setForm(f)
      setAdvanced(!!(f.headers || f.body))
      setLoaded(true)
    }
  }, [isEdit, monitor.data, loaded])

  // Pre-check default notifications on create.
  useEffect(() => {
    if (!defaultsApplied && notifications.data) {
      setForm((f) => ({ ...f, notification_ids: notifications.data.filter((n) => n.is_default).map((n) => n.id) }))
      setDefaultsApplied(true)
    }
  }, [defaultsApplied, notifications.data])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs = validate(form.type !== 'tcp' && pendingPath ? { ...form, url: applyPath(form.url, pendingPath) } : form)
    setErrors(errs)
    if (Object.keys(errs).length) {
      if (errs.headers) setAdvanced(true)
      toast.error(t('mf.fixErrors'))
      return
    }
    setSaving(true)
    try {
      const input = toInput(form.type !== 'tcp' && pendingPath ? { ...form, url: applyPath(form.url, pendingPath) } : form)
      const saved = isEdit ? await api.updateMonitor(editId!, input) : await api.createMonitor(input)
      toast.success(isEdit ? t('mf.updated') : t('mf.created'))
      if (saved) qc.setQueryData(['monitor', saved.id], saved)
      await qc.invalidateQueries({ queryKey: ['monitors'] })
      qc.invalidateQueries({ queryKey: ['groups'] })
      if (isEdit) qc.invalidateQueries({ queryKey: ['monitor', editId] })
      navigate(`/dashboard/${saved?.id ?? editId ?? ''}`)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const backTo = isEdit ? `/dashboard/${editId}` : '/dashboard'
  const isHttp = form.type !== 'tcp'

  if (isEdit && monitor.isError) {
    return (
      <div className="text-muted-foreground py-16 text-center text-sm">
        {t('mf.loadFailed', { error: errorMessage(monitor.error) })}
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title={isEdit ? t('mf.titleEdit') : t('mf.titleNew')}
        description={isEdit ? monitor.data?.name : t('mf.subtitleNew')}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link to={backTo}>
              <ArrowLeft />
              {t('common.back')}
            </Link>
          </Button>
        }
      />

      {!isEdit && loaded && <TemplatePicker activeId={templateId} onPick={pickTemplate} />}

      {!loaded ? (
        <Card className="lg:max-w-[50%]">
          <CardContent className="grid gap-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </CardContent>
        </Card>
      ) : (
        <form onSubmit={submit} className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2" noValidate>
          <div className="grid min-w-0 grid-cols-1 content-start gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('mf.general')}</CardTitle>
                <CardDescription>{t('mf.generalDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5 sm:col-span-2">
                  <span className="text-sm leading-none font-medium" id="type-label">
                    {t('mf.type')}
                  </span>
                  <div role="radiogroup" aria-labelledby="type-label" className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                    {typeOptions.map((o) => {
                      const on = form.type === o.value
                      return (
                        <button
                          key={o.value}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => set('type', o.value)}
                          className={cn(
                            'hover:border-border-strong focus-visible:ring-ring/50 flex flex-col gap-1.5 rounded-xl border p-3 text-left transition-[border-color,background-color,box-shadow] duration-150 outline-none focus-visible:ring-[3px]',
                            on && 'border-primary/60 bg-primary/[0.06] ring-primary/25 ring-2',
                          )}
                        >
                          <span className="flex items-center gap-2 text-sm font-medium">
                            <o.icon className={cn('size-4', on ? 'text-primary' : 'text-muted-foreground')} />
                            {t(o.label)}
                          </span>
                          <span className="text-muted-foreground text-xs leading-snug">{t(o.desc)}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
                <Field label={t('common.name')} htmlFor="name" error={errors.name} className="sm:col-span-2">
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => set('name', e.target.value)}
                    placeholder={t('mf.namePlaceholder')}
                    aria-invalid={!!errors.name}
                  />
                </Field>

                {isHttp ? (
                  <>
                    <Field label="URL" htmlFor="url" error={errors.url} className="sm:col-span-2">
                      <div className="flex gap-2">
                        <Select value={form.method} onValueChange={(v) => set('method', v)}>
                          <SelectTrigger className="w-28 shrink-0" aria-label={t('mf.method')}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {METHODS.map((m) => (
                              <SelectItem key={m} value={m}>
                                {m}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          id="url"
                          type="url"
                          inputMode="url"
                          value={form.url}
                          onChange={(e) => {
                            set('url', e.target.value)
                            setAppliedPath(null)
                          }}
                          placeholder={t('mf.urlPlaceholder')}
                          aria-invalid={!!errors.url}
                        />
                      </div>
                      {(pendingPath || appliedPath) && !errors.url && (
                        <p className="text-muted-foreground mt-1.5 text-xs">{t('tpl.pathHint', { path: pendingPath ?? appliedPath ?? '' })}</p>
                      )}
                    </Field>
                    {form.type === 'keyword' && (
                      <>
                        <Field
                          label={t('mf.keyword')}
                          htmlFor="keyword"
                          error={errors.keyword}
                          hint={t('mf.keywordHint')}
                        >
                          <Input
                            id="keyword"
                            value={form.keyword}
                            onChange={(e) => set('keyword', e.target.value)}
                            aria-invalid={!!errors.keyword}
                          />
                        </Field>
                        <SwitchField
                          id="invert_keyword"
                          label={t('mf.invertKeyword')}
                          description={t('mf.invertKeywordDesc')}
                          checked={form.invert_keyword}
                          onCheckedChange={(v) => set('invert_keyword', v)}
                          className="self-end"
                        />
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <Field label={t('mf.host')} htmlFor="hostname" error={errors.hostname}>
                      <Input
                        id="hostname"
                        value={form.hostname}
                        onChange={(e) => set('hostname', e.target.value)}
                        placeholder={t('mf.hostPlaceholder')}
                        aria-invalid={!!errors.hostname}
                      />
                    </Field>
                    <Field label={t('mf.port')} htmlFor="port" error={errors.port}>
                      <Input
                        id="port"
                        inputMode="numeric"
                        value={form.port}
                        onChange={(e) => set('port', e.target.value)}
                        placeholder="443"
                        aria-invalid={!!errors.port}
                      />
                    </Field>
                  </>
                )}

                <Field label={t('mf.group')} htmlFor="group" className="sm:col-span-2">
                  <GroupCombobox id="group" value={form.group_id} onChange={(v) => set('group_id', v)} fallbackName={monitor.data?.group_name} />
                </Field>

                <Field label={t('tags.label')} htmlFor="tags" hint={t('tags.hint')} className="sm:col-span-2">
                  <TagsInput id="tags" value={form.tags} onChange={(v) => set('tags', v)} />
                </Field>

                <Field label={t('mf.description')} htmlFor="description" className="sm:col-span-2">
                  <Textarea
                    id="description"
                    rows={2}
                    value={form.description}
                    onChange={(e) => set('description', e.target.value)}
                    placeholder={t('common.optional')}
                  />
                </Field>
              </CardContent>
            </Card>

            {isHttp && (
              <Card className="py-0">
                <Collapsible open={advanced} onOpenChange={setAdvanced}>
                  <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-4 text-left">
                    <ChevronRight className={cn('size-4 transition-transform', advanced && 'rotate-90')} />
                    <span className="font-semibold">{t('mf.advanced')}</span>
                    <span className="text-muted-foreground truncate text-sm">{t('mf.advancedDesc')}</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2">
                      <Field label={t('mf.headers')} htmlFor="headers" error={errors.headers}>
                        <Textarea
                          id="headers"
                          rows={5}
                          className="font-mono text-xs"
                          value={form.headers}
                          onChange={(e) => set('headers', e.target.value)}
                          placeholder={'{\n  "Authorization": "Bearer …"\n}'}
                          aria-invalid={!!errors.headers}
                        />
                      </Field>
                      <Field label={t('mf.body')} htmlFor="body">
                        <Textarea
                          id="body"
                          rows={5}
                          className="font-mono text-xs"
                          value={form.body}
                          onChange={(e) => set('body', e.target.value)}
                          placeholder={t('mf.bodyPlaceholder')}
                        />
                      </Field>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            )}
          </div>
          <div className="grid min-w-0 grid-cols-1 content-start gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('mf.checkSettings')}</CardTitle>
                <CardDescription>{t('mf.checkSettingsDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field label={t('mf.interval')} htmlFor="interval" error={errors.interval} hint={t('mf.intervalHint')}>
                  <Input
                    id="interval"
                    inputMode="numeric"
                    value={form.interval}
                    onChange={(e) => set('interval', e.target.value)}
                    aria-invalid={!!errors.interval}
                  />
                </Field>
                <Field
                  label={t('mf.retryInterval')}
                  htmlFor="retry_interval"
                  error={errors.retry_interval}
                  hint={t('mf.retryIntervalHint')}
                >
                  <Input
                    id="retry_interval"
                    inputMode="numeric"
                    value={form.retry_interval}
                    onChange={(e) => set('retry_interval', e.target.value)}
                    aria-invalid={!!errors.retry_interval}
                  />
                </Field>
                <Field
                  label={t('mf.maxRetries')}
                  htmlFor="max_retries"
                  error={errors.max_retries}
                  hint={t('mf.maxRetriesHint')}
                >
                  <Input
                    id="max_retries"
                    inputMode="numeric"
                    value={form.max_retries}
                    onChange={(e) => set('max_retries', e.target.value)}
                    aria-invalid={!!errors.max_retries}
                  />
                </Field>
                <Field label={t('mf.timeout')} htmlFor="timeout" error={errors.timeout}>
                  <Input
                    id="timeout"
                    inputMode="numeric"
                    value={form.timeout}
                    onChange={(e) => set('timeout', e.target.value)}
                    aria-invalid={!!errors.timeout}
                  />
                </Field>

                {isHttp && (
                  <>
                    <Field
                      label={t('mf.acceptedStatus')}
                      htmlFor="accepted_status"
                      error={errors.accepted_status}
                      hint={t('mf.acceptedStatusHint')}
                    >
                      <Input
                        id="accepted_status"
                        value={form.accepted_status}
                        onChange={(e) => set('accepted_status', e.target.value)}
                        aria-invalid={!!errors.accepted_status}
                      />
                    </Field>
                    <Field
                      label={t('mf.maxRedirects')}
                      htmlFor="max_redirects"
                      error={errors.max_redirects}
                      hint={t('mf.maxRedirectsHint')}
                      >
                      <Input
                        id="max_redirects"
                        inputMode="numeric"
                        value={form.max_redirects}
                        onChange={(e) => set('max_redirects', e.target.value)}
                        aria-invalid={!!errors.max_redirects}
                      />
                    </Field>
                  </>
                )}

                <div className="grid gap-3 sm:col-span-2">
                  {isHttp && (
                    <SwitchField
                      id="ignore_tls"
                      label={t('mf.ignoreTls')}
                      description={t('mf.ignoreTlsDesc')}
                      checked={form.ignore_tls}
                      onCheckedChange={(v) => set('ignore_tls', v)}
                    />
                  )}
                  <SwitchField
                    id="upside_down"
                    label={t('mf.upsideDown')}
                    description={t('mf.upsideDownDesc')}
                    checked={form.upside_down}
                    onCheckedChange={(v) => set('upside_down', v)}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('mf.notifications')}</CardTitle>
                <CardDescription>{t('mf.notificationsDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                {notifications.isPending ? (
                  <Skeleton className="h-9 w-full" />
                ) : !notifications.data?.length ? (
                  <p className="text-muted-foreground text-sm">
                    {t('mf.noChannels')}{' '}
                    <Link to="/notifications" className="text-foreground underline underline-offset-4">
                      {t('notif.add')}
                    </Link>
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {notifications.data.map((n) => {
                      const Icon = kindIcon[n.kind] ?? Webhook
                      const checked = form.notification_ids.includes(n.id)
                      return (
                        <Label
                          key={n.id}
                          htmlFor={`n-${n.id}`}
                          className="hover:bg-accent/50 flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 font-normal"
                        >
                          <Checkbox
                            id={`n-${n.id}`}
                            checked={checked}
                            onCheckedChange={(v) =>
                              set(
                                'notification_ids',
                                v
                                  ? [...form.notification_ids, n.id]
                                  : form.notification_ids.filter((x) => x !== n.id),
                              )
                            }
                          />
                          <Icon className="text-muted-foreground size-4" />
                          <span className="truncate">{n.name}</span>
                          {n.is_default && <span className="text-muted-foreground ml-auto text-xs">{t('common.default')}</span>}
                        </Label>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="bg-background/85 sticky bottom-0 z-10 -mx-3 flex justify-end gap-2 border-t px-3 py-3 backdrop-blur-md sm:-mx-4 sm:px-4 lg:col-span-2 lg:-mx-6 lg:px-6">
            <Button asChild variant="outline">
              <Link to={backTo}>{t('common.cancel')}</Link>
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              {isEdit ? t('common.save') : t('common.create')}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
