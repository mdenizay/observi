import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Folder, Info, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app-shell'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { ListCard, ListRow, ListSearch, ListSkeleton, RowActions } from '@/components/list-kit'
import { statusDot } from '@/components/status-badge'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Field } from '@/components/field'
import { MonitorPicker } from '@/components/monitor-picker'
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
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useGroups } from '@/hooks/use-groups'
import { useMonitors } from '@/hooks/use-monitors'
import { api, errorMessage } from '@/lib/api'
import type { Group } from '@/lib/types'
import { richText, useI18n } from '@/i18n'

function GroupDialog({
  open,
  onOpenChange,
  group,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  group: Group | null
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const monitors = useMonitors()
  const [name, setName] = useState(group?.name ?? '')
  const [monitorIds, setMonitorIds] = useState<number[]>(group?.monitor_ids ?? [])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError(t('groups.nameRequired'))
      return
    }
    setSaving(true)
    try {
      if (group) await api.updateGroup(group.id, { name: name.trim(), monitor_ids: monitorIds })
      else await api.createGroup({ name: name.trim(), monitor_ids: monitorIds })
      toast.success(group ? t('groups.updated') : t('groups.created'))
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['groups'] }),
        qc.invalidateQueries({ queryKey: ['monitors'] }),
      ])
      qc.invalidateQueries({ queryKey: ['monitor'] })
      onOpenChange(false)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{group ? t('groups.editTitle') : t('groups.new')}</DialogTitle>
          <DialogDescription>{t('groups.dialogDesc')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <Field label={t('groups.nameLabel')} htmlFor="g-name" error={error}>
            <Input
              id="g-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
              placeholder={t('groups.namePlaceholder')}
              aria-invalid={!!error}
            />
          </Field>
          <div className="grid gap-1.5">
            <Label>{t('groups.monitors')}</Label>
            <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
              <Info className="mt-px size-3.5 shrink-0" />
              {t('groups.note')}
            </p>
            {monitors.isPending ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <MonitorPicker
                monitors={monitors.data ?? []}
                value={monitorIds}
                onChange={setMonitorIds}
                annotate={(m) => (m.group_id !== null && m.group_id !== group?.id ? m.group_name : null)}
              />
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              {group ? t('common.save') : t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function GroupsPage() {
  const { t, lang } = useI18n()
  const qc = useQueryClient()
  const groups = useGroups()
  const monitors = useMonitors()
  const [q, setQ] = useState('')
  const [dialog, setDialog] = useState<{ open: boolean; group: Group | null; key: number }>({
    open: false,
    group: null,
    key: 0,
  })
  const [toDelete, setToDelete] = useState<Group | null>(null)
  const openDialog = (group: Group | null) => setDialog((d) => ({ open: true, group, key: d.key + 1 }))

  const list = useMemo(() => {
    const term = q.trim().toLocaleLowerCase(lang)
    return (groups.data ?? []).filter((g) => !term || g.name.toLocaleLowerCase(lang).includes(term))
  }, [groups.data, q, lang])

  const dotsFor = (g: Group) =>
    (monitors.data ?? [])
      .filter((m) => g.monitor_ids.includes(m.id))
      .slice(0, 12)
      .map((m) => <span key={m.id} className={cn('size-1.5 rounded-full', statusDot[m.active ? m.status : 'paused'])} />)

  return (
    <div>
      <PageHeader
        title={t('groups.title')}
        count={groups.data ? formatNumber(groups.data.length) : undefined}
        description={t('groups.desc')}
        actions={
          <Button onClick={() => openDialog(null)}>
            <Plus />
            {t('groups.new')}
          </Button>
        }
      />
      <div className="mb-3">
        <ListSearch value={q} onChange={setQ} />
      </div>

      {groups.isPending ? (
        <ListSkeleton />
      ) : groups.isError ? (
        <ListCard>
          <p className="text-muted-foreground p-8 text-center text-sm">{errorMessage(groups.error)}</p>
        </ListCard>
      ) : !groups.data.length ? (
        <ListCard>
          <EmptyState
            kind="groups"
            title={t('groups.empty')}
            description={t('groups.desc')}
            action={
              <Button size="sm" variant="outline" onClick={() => openDialog(null)}>
                <Plus />
                {t('groups.add')}
              </Button>
            }
          />
        </ListCard>
      ) : list.length === 0 ? (
        <ListCard>
          <EmptyState kind="search" title={t('common.noResults')} />
        </ListCard>
      ) : (
        <ListCard>
          {list.map((g) => (
            <ListRow
              key={g.id}
              onClick={() => openDialog(g)}
              leading={
                <div className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg border">
                  <Folder className="size-4" />
                </div>
              }
              title={<span className="truncate">{g.name}</span>}
              subtitle={t('monitors.count', { count: g.monitor_ids.length })}
              meta={<div className="flex max-w-40 flex-wrap justify-end gap-1">{dotsFor(g)}</div>}
              actions={<RowActions onEdit={() => openDialog(g)} onDelete={() => setToDelete(g)} />}
            />
          ))}
        </ListCard>
      )}

      <GroupDialog
        key={dialog.key}
        open={dialog.open}
        group={dialog.group}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t('groups.deleteTitle')}
        description={richText(t('groups.deleteDesc'), {
          name: <strong className="text-foreground">{toDelete?.name}</strong>,
        })}
        onConfirm={async () => {
          if (!toDelete) return
          try {
            await api.deleteGroup(toDelete.id)
            toast.success(t('groups.deleted'))
            qc.invalidateQueries({ queryKey: ['groups'] })
            qc.invalidateQueries({ queryKey: ['monitors'] })
            qc.invalidateQueries({ queryKey: ['users'] })
          } catch (e) {
            toast.error(errorMessage(e))
            throw e
          }
        }}
      />
    </div>
  )
}
