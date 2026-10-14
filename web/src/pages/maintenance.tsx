import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, MoreHorizontal, Pencil, Plus, Square, Trash2, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app-shell'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { Field, SwitchField } from '@/components/field'
import { GroupChecklist } from '@/components/group-checklist'
import { ListCard, ListRow, ListSearch, ListSkeleton } from '@/components/list-kit'
import { MonitorPicker } from '@/components/monitor-picker'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useGroups } from '@/hooks/use-groups'
import { useNow } from '@/hooks/use-now'
import { useMonitors } from '@/hooks/use-monitors'
import { richText, translate, useI18n } from '@/i18n'
import { api, errorMessage } from '@/lib/api'
import { formatDateTime, formatDuration, formatNumber } from '@/lib/format'
import type { MaintenanceInput, MaintenanceWindow } from '@/lib/types'
import { cn } from '@/lib/utils'

const key = ['maintenance'] as const

/** `YYYY-MM-DDTHH:mm` in the browser's local timezone (for datetime-local inputs). */
function toLocalInput(ms: number) {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

function statusOf(w: MaintenanceWindow, now: number): 'active' | 'scheduled' | 'ended' {
  if (w.active) return 'active'
  if (w.recur) return 'scheduled'
  if (w.start_at && w.start_at > now) return 'scheduled'
  return w.next_start ? 'scheduled' : 'ended'
}

function WindowDialog({
  open,
  onOpenChange,
  win,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  win: MaintenanceWindow | null
}) {
  const { t, lang } = useI18n()
  const qc = useQueryClient()
  const monitors = useMonitors()
  const groups = useGroups()
  const [now] = useState(() => Date.now())

  const [name, setName] = useState(win?.name ?? '')
  const [kind, setKind] = useState<'maintenance' | 'mute'>(win?.kind ?? 'maintenance')
  const [mode, setMode] = useState<'once' | 'weekly'>(win?.recur ? 'weekly' : 'once')
  const [start, setStart] = useState(toLocalInput(win?.start_at ?? now))
  const [end, setEnd] = useState(toLocalInput(win?.end_at ?? now + 3600_000))
  const [days, setDays] = useState<number[]>(win?.recur?.days ?? [1])
  const [time, setTime] = useState(hhmm(win?.recur?.start_min ?? 120))
  const [duration, setDuration] = useState(String(win?.recur?.duration_min ?? 60))
  const [all, setAll] = useState(win?.all ?? false)
  const [monitorIds, setMonitorIds] = useState<number[]>(win?.monitor_ids ?? [])
  const [groupIds, setGroupIds] = useState<number[]>(win?.group_ids ?? [])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const weekday = (d: number) => new Intl.DateTimeFormat(lang, { weekday: 'short' }).format(new Date(2024, 0, 7 + d))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!name.trim()) errs.name = t('common.nameRequired')
    const body: MaintenanceInput = { name: name.trim(), kind, all, monitor_ids: all ? [] : monitorIds, group_ids: all ? [] : groupIds }
    if (mode === 'once') {
      const s = new Date(start).getTime()
      const en = new Date(end).getTime()
      if (!Number.isFinite(s) || !Number.isFinite(en) || en <= s) errs.times = t('maint.v.times')
      body.start_at = s
      body.end_at = en
      body.recur = null
    } else {
      const dur = Number(duration)
      const [h, m] = time.split(':').map(Number)
      if (days.length === 0) errs.days = t('maint.v.days')
      if (!Number.isInteger(dur) || dur < 1) errs.duration = t('maint.v.duration')
      if (!Number.isFinite(h) || !Number.isFinite(m)) errs.times = t('maint.v.times')
      body.recur = {
        days: [...days].sort(),
        start_min: (h || 0) * 60 + (m || 0),
        duration_min: dur,
        tz_offset_min: -new Date().getTimezoneOffset(),
      }
      body.start_at = null
      body.end_at = null
    }
    if (!all && monitorIds.length === 0 && groupIds.length === 0) errs.scope = translate('errors.maintenance_scope_required')
    setErrors(errs)
    if (Object.keys(errs).length) return
    setSaving(true)
    try {
      if (win) await api.maintenanceUpdate(win.id, body)
      else await api.maintenanceCreate(body)
      toast.success(win ? t('maint.updated') : t('maint.created'))
      await qc.invalidateQueries({ queryKey: key })
      qc.invalidateQueries({ queryKey: ['monitors'] })
      onOpenChange(false)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const seg = <T extends string>(value: T, cur: T, set: (v: T) => void, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={cur === value}
      onClick={() => set(value)}
      className={cn(
        'text-muted-foreground flex-1 rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors',
        cur === value && 'bg-background text-foreground shadow-xs',
      )}
    >
      {label}
    </button>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{win ? t('maint.editTitle') : t('maint.new')}</DialogTitle>
          <DialogDescription>{t('maint.desc')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <Field label={t('maint.name')} htmlFor="mw-name" error={errors.name}>
            <Input
              id="mw-name"
              value={name}
              maxLength={80}
              onChange={(e) => {
                setName(e.target.value)
                setErrors((x) => ({ ...x, name: '' }))
              }}
              placeholder={t('maint.namePlaceholder')}
              aria-invalid={!!errors.name}
            />
          </Field>

          <div className="grid gap-1.5">
            <Label>{t('maint.type')}</Label>
            <div className="bg-muted flex rounded-md p-0.5" role="radiogroup" aria-label={t('maint.type')}>
              {seg('maintenance', kind, setKind, t('maint.typeMaintenance'))}
              {seg('mute', kind, setKind, t('maint.typeMute'))}
            </div>
            <p className="text-muted-foreground text-xs">
              {kind === 'maintenance' ? t('maint.typeHelpMaintenance') : t('maint.typeHelpMute')}
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label>{t('maint.schedule')}</Label>
            <div className="bg-muted flex rounded-md p-0.5" role="radiogroup" aria-label={t('maint.schedule')}>
              {seg('once', mode, setMode, t('maint.once'))}
              {seg('weekly', mode, setMode, t('maint.weekly'))}
            </div>
            {mode === 'once' ? (
              <div className="grid gap-3 pt-1 sm:grid-cols-2">
                <Field label={t('maint.startAt')} htmlFor="mw-start" error={errors.times}>
                  <Input id="mw-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
                </Field>
                <Field label={t('maint.endAt')} htmlFor="mw-end">
                  <Input id="mw-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
                </Field>
              </div>
            ) : (
              <div className="grid gap-3 pt-1">
                <div className="grid gap-1.5">
                  <span className="text-sm leading-none font-medium">{t('maint.days')}</span>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('maint.days')}>
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                      const on = days.includes(d)
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setDays((p) => (on ? p.filter((x) => x !== d) : [...p, d]))}
                          className={cn(
                            'hover:bg-accent focus-visible:ring-ring/50 h-8 min-w-11 rounded-md border px-2.5 text-sm outline-none focus-visible:ring-[3px]',
                            on && 'border-foreground/60 bg-accent font-medium',
                          )}
                        >
                          {weekday(d)}
                        </button>
                      )
                    })}
                  </div>
                  {errors.days && <p className="text-destructive text-xs">{errors.days}</p>}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t('maint.startTime')} htmlFor="mw-time" error={errors.times}>
                    <Input id="mw-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                  </Field>
                  <Field label={t('maint.duration')} htmlFor="mw-dur" error={errors.duration}>
                    <Input
                      id="mw-dur"
                      inputMode="numeric"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value.replace(/\D/g, ''))}
                      aria-invalid={!!errors.duration}
                    />
                  </Field>
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-2">
            <Label>{t('maint.scope')}</Label>
            <SwitchField id="mw-all" label={t('maint.allMonitors')} description={t('maint.allMonitorsHelp')} checked={all} onCheckedChange={setAll} />
            {!all && (
              <>
                <MonitorPicker monitors={monitors.data ?? []} value={monitorIds} onChange={setMonitorIds} maxHeight="max-h-40" />
                {groups.data && groups.data.length > 0 && (
                  <div className="grid gap-1.5">
                    <span className="text-sm leading-none font-medium">{t('maint.groups')}</span>
                    <GroupChecklist groups={groups.data} value={groupIds} onChange={setGroupIds} />
                  </div>
                )}
                {errors.scope && <p className="text-destructive text-xs">{errors.scope}</p>}
              </>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              {win ? t('common.save') : t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function MaintenancePage() {
  const { t, lang } = useI18n()
  const qc = useQueryClient()
  const list = useQuery({ queryKey: key, queryFn: api.maintenanceList, select: (d) => d.items, refetchInterval: 60_000 })
  const [q, setQ] = useState('')
  const [dialog, setDialog] = useState<{ open: boolean; win: MaintenanceWindow | null; key: number }>({ open: false, win: null, key: 0 })
  const [toDelete, setToDelete] = useState<MaintenanceWindow | null>(null)
  const open = (win: MaintenanceWindow | null) => setDialog((d) => ({ open: true, win, key: d.key + 1 }))
  const now = useNow(30_000)

  const shown = useMemo(() => {
    const term = q.trim().toLocaleLowerCase(lang)
    return (list.data ?? []).filter((w) => !term || w.name.toLocaleLowerCase(lang).includes(term))
  }, [list.data, q, lang])

  const scope = (w: MaintenanceWindow) => {
    if (w.all) return t('maint.scopeAll')
    const parts = []
    if (w.monitor_ids.length) parts.push(t('monitors.count', { count: w.monitor_ids.length }))
    if (w.group_ids.length) parts.push(t('groups.count', { count: w.group_ids.length }))
    return parts.length ? parts.join(', ') : t('maint.scopeNone')
  }
  const schedule = (w: MaintenanceWindow) => {
    if (w.recur) {
      const dn = new Intl.DateTimeFormat(lang, { weekday: 'short' })
      const days = [...w.recur.days].sort().map((d) => dn.format(new Date(2024, 0, 7 + d))).join(', ')
      return t('maint.every', { days, time: hhmm(w.recur.start_min), duration: formatDuration(w.recur.duration_min * 60_000) })
    }
    return w.start_at && w.end_at ? `${formatDateTime(w.start_at)} → ${formatDateTime(w.end_at)}` : '—'
  }

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: key })
    qc.invalidateQueries({ queryKey: ['monitors'] })
  }
  const endNow = async (w: MaintenanceWindow) => {
    try {
      await api.maintenanceEnd(w.id)
      toast.success(t('maint.endedToast'))
      await invalidate()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div>
      <PageHeader
        title={t('maint.title')}
        count={list.data ? formatNumber(list.data.length) : undefined}
        description={t('maint.desc')}
        actions={
          <Button onClick={() => open(null)}>
            <Plus />
            {t('maint.new')}
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
      ) : (list.data ?? []).length === 0 ? (
        <ListCard>
          <EmptyState
            kind="monitors"
            title={t('maint.empty')}
            description={t('maint.emptyDesc')}
            action={
              <Button size="sm" variant="outline" onClick={() => open(null)}>
                <Plus />
                {t('maint.new')}
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
          {shown.map((w) => {
            const st = statusOf(w, now)
            return (
              <ListRow
                key={w.id}
                onClick={() => open(w)}
                leading={
                  <div className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg border">
                    <Wrench className="size-4" />
                  </div>
                }
                title={
                  <>
                    <span className="truncate">{w.name}</span>
                    <Badge variant={w.kind === 'maintenance' ? 'maint' : 'secondary'}>
                      {w.kind === 'maintenance' ? t('maint.kindMaintenance') : t('maint.kindMute')}
                    </Badge>
                  </>
                }
                subtitle={`${scope(w)} · ${schedule(w)}`}
                meta={
                  <Badge variant={st === 'active' ? 'maint' : st === 'scheduled' ? 'muted' : 'paused'}>
                    {t(st === 'active' ? 'maint.stActive' : st === 'scheduled' ? 'maint.stScheduled' : 'maint.stEnded')}
                  </Badge>
                }
                actions={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label={t('list.actions')} title={t('list.actions')}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-40">
                      <DropdownMenuItem onSelect={() => open(w)}>
                        <Pencil />
                        {t('common.edit')}
                      </DropdownMenuItem>
                      {st === 'active' && (
                        <DropdownMenuItem onSelect={() => void endNow(w)}>
                          <Square />
                          {t('maint.endNow')}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive onSelect={() => setToDelete(w)}>
                        <Trash2 />
                        {t('common.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            )
          })}
        </ListCard>
      )}

      <WindowDialog
        key={dialog.key}
        open={dialog.open}
        win={dialog.win}
        onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))}
      />

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t('maint.deleteTitle')}
        description={richText(t('maint.deleteDesc'), { name: <strong className="text-foreground">{toDelete?.name}</strong> })}
        onConfirm={async () => {
          if (!toDelete) return
          try {
            await api.maintenanceDelete(toDelete.id)
            toast.success(t('maint.deleted'))
            await invalidate()
          } catch (e) {
            toast.error(errorMessage(e))
            throw e
          }
        }}
      />
    </div>
  )
}
