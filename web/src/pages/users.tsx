import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Folder, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app-shell'
import { Avatar } from '@/components/avatar'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { ListCard, ListRow, ListSearch, ListSkeleton, RowActions } from '@/components/list-kit'
import { formatNumber } from '@/lib/format'
import { Field } from '@/components/field'
import { MonitorPicker } from '@/components/monitor-picker'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useUser } from '@/hooks/use-auth'
import { useGroups } from '@/hooks/use-groups'
import { useMonitors } from '@/hooks/use-monitors'
import { api, errorMessage } from '@/lib/api'
import type { Group, ManagedUser, Role } from '@/lib/types'
import { richText, useI18n } from '@/i18n'

function GroupChecklist({
  groups,
  value,
  onChange,
}: {
  groups: Group[]
  value: number[]
  onChange: (ids: number[]) => void
}) {
  const { t } = useI18n()
  if (!groups.length)
    return <div className="text-muted-foreground rounded-lg border px-3 py-2.5 text-sm">{t('users.noGroups')}</div>
  return (
    <div className="max-h-36 overflow-y-auto rounded-lg border p-1">
      {groups.map((g) => (
        <label
          key={g.id}
          className="hover:bg-accent/60 flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm"
        >
          <Checkbox
            checked={value.includes(g.id)}
            onCheckedChange={(v) => onChange(v === true ? [...value, g.id] : value.filter((x) => x !== g.id))}
          />
          <Folder className="text-muted-foreground size-3.5" />
          <span className="truncate">{g.name}</span>
          <span className="text-muted-foreground ml-auto text-xs tabular-nums">{t('monitors.count', { count: g.monitor_ids.length })}</span>
        </label>
      ))}
    </div>
  )
}

function UserDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  user: ManagedUser | null
}) {
  const { t } = useI18n()
  const me = useUser()
  const qc = useQueryClient()
  const monitors = useMonitors()
  const groups = useGroups()
  const isEdit = !!user
  const isSelf = user?.id === me.id

  const [name, setName] = useState(user?.name ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>(user?.role ?? 'user')
  const [monitorIds, setMonitorIds] = useState<number[]>(user?.monitor_ids ?? [])
  const [groupIds, setGroupIds] = useState<number[]>(user?.group_ids ?? [])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!name.trim()) errs.name = t('common.nameRequired')
    if (!isEdit && !username.trim()) errs.username = t('users.usernameRequired')
    if (!isEdit && !password) errs.password = t('users.passwordRequired')
    if (password && password.length < 8) errs.password = t('users.passwordShort')
    setErrors(errs)
    if (Object.keys(errs).length) return

    setSaving(true)
    try {
      if (isEdit) {
        await api.updateUser(user.id, {
          name: name.trim(),
          role,
          monitor_ids: monitorIds,
          group_ids: groupIds,
          ...(password ? { password } : {}),
        })
        toast.success(t('users.updated'))
      } else {
        await api.createUser({ name: name.trim(), username: username.trim(), password, role, monitor_ids: monitorIds, group_ids: groupIds })
        toast.success(t('users.created'))
      }
      await qc.invalidateQueries({ queryKey: ['users'] })
      if (isSelf) qc.invalidateQueries({ queryKey: ['me'] })
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
          <DialogTitle>{isEdit ? t('users.editTitle') : t('users.new')}</DialogTitle>
          <DialogDescription>
            {isEdit ? `@${user.username}` : t('users.newDesc')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('common.name')} htmlFor="u-name" error={errors.name}>
              <Input
                id="u-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('users.namePlaceholder')}
                aria-invalid={!!errors.name}
              />
            </Field>
            {!isEdit && (
              <Field label={t('common.username')} htmlFor="u-username" error={errors.username}>
                <Input
                  id="u-username"
                  autoCapitalize="none"
                  autoComplete="off"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('users.usernamePlaceholder')}
                  aria-invalid={!!errors.username}
                />
              </Field>
            )}
            <Field
              label={t('common.password')}
              htmlFor="u-password"
              error={errors.password}
              hint={isEdit ? t('users.passwordHint') : undefined}
            >
              <Input
                id="u-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!errors.password}
              />
            </Field>
            <Field
              label={t('users.role')}
              htmlFor="u-role"
              hint={isSelf ? t('users.roleSelfHint') : undefined}
            >
              <Select value={role} onValueChange={(v) => setRole(v as Role)} disabled={isSelf}>
                <SelectTrigger id="u-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="superadmin">{t('role.superadmin')}</SelectItem>
                  <SelectItem value="user">{t('role.user')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          {role === 'user' ? (
            <>
              <div className="grid gap-1.5">
                <Label>{t('users.groups')}</Label>
                <p className="text-muted-foreground text-xs">{t('users.groupsHint')}</p>
                {groups.isPending ? (
                  <Skeleton className="h-16 w-full" />
                ) : (
                  <GroupChecklist groups={groups.data ?? []} value={groupIds} onChange={setGroupIds} />
                )}
              </div>
              <div className="grid gap-1.5">
                <Label>{t('users.extraMonitors')}</Label>
                {monitors.isPending ? (
                  <Skeleton className="h-40 w-full" />
                ) : (
                  <MonitorPicker
                    monitors={monitors.data ?? []}
                    value={monitorIds}
                    onChange={setMonitorIds}
                    maxHeight="max-h-44"
                    annotate={(m) => (m.group_id !== null && groupIds.includes(m.group_id) ? t('users.viaGroup') : null)}
                  />
                )}
              </div>
            </>
          ) : (
            <p className="text-muted-foreground bg-muted/50 rounded-lg px-3 py-2.5 text-sm">
              {t('users.adminNote')}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              {isEdit ? t('common.save') : t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function UsersPage() {
  const { t, lang } = useI18n()
  const me = useUser()
  const qc = useQueryClient()
  const users = useQuery({ queryKey: ['users'], queryFn: api.users })
  const groups = useGroups()
  const [q, setQ] = useState('')
  const [dialog, setDialog] = useState<{ open: boolean; user: ManagedUser | null; key: number }>({
    open: false,
    user: null,
    key: 0,
  })
  const [toDelete, setToDelete] = useState<ManagedUser | null>(null)

  const openDialog = (user: ManagedUser | null) => setDialog((d) => ({ open: true, user, key: d.key + 1 }))
  const groupName = (id: number) => groups.data?.find((g) => g.id === id)?.name

  const list = useMemo(() => {
    const term = q.trim().toLocaleLowerCase(lang)
    return (users.data ?? []).filter(
      (u) =>
        !term || u.name.toLocaleLowerCase(lang).includes(term) || u.username.toLocaleLowerCase(lang).includes(term),
    )
  }, [users.data, q, lang])

  return (
    <div>
      <PageHeader
        title={t('users.title')}
        count={users.data ? formatNumber(users.data.length) : undefined}
        description={t('users.desc')}
        actions={
          <Button onClick={() => openDialog(null)}>
            <Plus />
            {t('users.new')}
          </Button>
        }
      />
      <div className="mb-3">
        <ListSearch value={q} onChange={setQ} />
      </div>
      {users.isPending ? (
        <ListSkeleton />
      ) : users.isError ? (
        <ListCard>
          <p className="text-muted-foreground p-8 text-center text-sm">{errorMessage(users.error)}</p>
        </ListCard>
      ) : list.length === 0 ? (
        <ListCard>
          <EmptyState kind={q ? 'search' : 'users'} title={t('common.noResults')} />
        </ListCard>
      ) : (
        <ListCard title={t('users.count', { count: list.length })} head={[t('users.colName'), t('users.colRole')]}>
          {list.map((u) => (
            <ListRow
              key={u.id}
              onClick={() => openDialog(u)}
              leading={<Avatar name={u.name || u.username} />}
              title={
                <>
                  <span className="truncate">{u.name}</span>
                  {u.id === me.id && <span className="text-muted-foreground text-xs font-normal">{t('users.you')}</span>}
                </>
              }
              subtitle={`@${u.username}`}
              meta={
                u.role === 'superadmin' ? (
                  <span className="text-muted-foreground text-xs">{t('users.allAccess')}</span>
                ) : (
                  <>
                    {u.group_ids?.slice(0, 2).map((g) => (
                      <Badge key={g} variant="outline" className="text-muted-foreground max-w-32 font-normal">
                        <Folder />
                        <span className="truncate">{groupName(g) ?? `#${g}`}</span>
                      </Badge>
                    ))}
                    {(u.group_ids?.length ?? 0) > 2 && (
                      <span className="text-muted-foreground text-xs">+{(u.group_ids?.length ?? 0) - 2}</span>
                    )}
                    <span className="text-muted-foreground num text-xs">
                      {t('monitors.count', { count: u.monitor_ids.length })}
                    </span>
                  </>
                )
              }
              actions={
                <>
                  <Badge variant={u.role === 'superadmin' ? 'default' : 'secondary'} className="hidden sm:inline-flex">
                    {u.role === 'superadmin' ? t('role.superadmin') : t('role.user')}
                  </Badge>
                  <RowActions
                    onEdit={() => openDialog(u)}
                    onDelete={() => setToDelete(u)}
                    deleteDisabled={u.id === me.id}
                  />
                </>
              }
            />
          ))}
        </ListCard>
      )}

      <UserDialog
        key={dialog.key}
        open={dialog.open}
        user={dialog.user}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t('users.deleteTitle')}
        description={richText(t('users.deleteDesc'), {
          name: <strong className="text-foreground">{toDelete?.name}</strong>,
          username: toDelete?.username,
        })}
        onConfirm={async () => {
          if (!toDelete) return
          try {
            await api.deleteUser(toDelete.id)
            toast.success(t('users.deleted'))
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
