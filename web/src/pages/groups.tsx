import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Folder, Info, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app-shell'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Field } from '@/components/field'
import { MonitorPicker } from '@/components/monitor-picker'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
  const { t } = useI18n()
  const qc = useQueryClient()
  const groups = useGroups()
  const [dialog, setDialog] = useState<{ open: boolean; group: Group | null; key: number }>({
    open: false,
    group: null,
    key: 0,
  })
  const [toDelete, setToDelete] = useState<Group | null>(null)
  const openDialog = (group: Group | null) => setDialog((d) => ({ open: true, group, key: d.key + 1 }))

  return (
    <div>
      <PageHeader
        title={t('groups.title')}
        description={t('groups.desc')}
        actions={
          <Button size="sm" onClick={() => openDialog(null)}>
            <Plus />
            {t('groups.new')}
          </Button>
        }
      />

      {groups.isPending ? (
        <div className="grid gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : groups.isError ? (
        <Card className="text-muted-foreground p-8 text-center text-sm">{errorMessage(groups.error)}</Card>
      ) : !groups.data.length ? (
        <Card className="text-muted-foreground flex flex-col items-center gap-3 p-10 text-center text-sm">
          {t('groups.empty')}
          <Button size="sm" variant="outline" onClick={() => openDialog(null)}>
            <Plus />
            {t('groups.add')}
          </Button>
        </Card>
      ) : (
        <Card className="gap-0 py-0">
          {groups.data.map((g, i) => (
            <div key={g.id} className={`flex items-center gap-3 px-4 py-3 ${i ? 'border-t' : ''}`}>
              <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
                <Folder className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{g.name}</div>
                <div className="text-muted-foreground text-xs tabular-nums">{t('monitors.count', { count: g.monitor_ids.length })}</div>
              </div>
              <Button size="icon-sm" variant="ghost" onClick={() => openDialog(g)} aria-label={t('common.edit')}>
                <Pencil />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setToDelete(g)}
                aria-label={t('common.delete')}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </Card>
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
