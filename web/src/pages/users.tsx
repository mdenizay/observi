import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Folder, KeyRound, Link2, Loader2, LogOut, Plus, ShieldCheck, ShieldOff } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app-shell'
import { Avatar } from '@/components/avatar'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { ListCard, ListRow, ListSearch, ListSkeleton, RowActions } from '@/components/list-kit'
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format'
import { CopyButton } from '@/components/copy-button'
import { useNow } from '@/hooks/use-now'
import { Field } from '@/components/field'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { PasswordField } from '@/components/password-field'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useUser } from '@/hooks/use-auth'
import { GroupChecklist } from '@/components/group-checklist'
import { useGroups } from '@/hooks/use-groups'
import { useMonitors } from '@/hooks/use-monitors'
import { api, errorMessage } from '@/lib/api'
import type { EmailResult, ManagedUser, Role } from '@/lib/types'
import { cn } from '@/lib/utils'
import { richText, useI18n } from '@/i18n'


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
  const [email, setEmail] = useState(user?.email ?? '')
  const [emailPassword, setEmailPassword] = useState(false)
  const mail = useQuery({ queryKey: ['mail-status'], queryFn: api.mailStatus, staleTime: 60_000 })
  const [role, setRole] = useState<Role>(user?.role ?? 'user')
  const [monitorIds, setMonitorIds] = useState<number[]>(user?.monitor_ids ?? [])
  const [groupIds, setGroupIds] = useState<number[]>(user?.group_ids ?? [])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const mailAvailable = mail.data?.available === true
  const canEmail = mailAvailable && !!email.trim() && (!isEdit || !!password)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!name.trim()) errs.name = t('common.nameRequired')
    if (!isEdit && !username.trim()) errs.username = t('users.usernameRequired')
    if (!isEdit && !password) errs.password = t('users.passwordRequired')
    if (password && password.length < 8) errs.password = t('users.passwordShort')
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) errs.email = t('errors.email_invalid')
    setErrors(errs)
    if (Object.keys(errs).length) return

    setSaving(true)
    try {
      const send = canEmail && emailPassword
      let res: EmailResult
      if (isEdit) {
        res = await api.updateUser(user.id, {
          name: name.trim(),
          role,
          monitor_ids: monitorIds,
          group_ids: groupIds,
          email: email.trim(),
          ...(password ? { password, email_password: send } : {}),
        })
        toast.success(t('users.updated'))
      } else {
        res = await api.createUser({
          name: name.trim(),
          username: username.trim(),
          password,
          role,
          monitor_ids: monitorIds,
          group_ids: groupIds,
          ...(email.trim() ? { email: email.trim() } : {}),
          email_password: send,
        })
        toast.success(t('users.created'))
      }
      if (res?.emailed === true) toast.success(t('users.emailSent', { email: email.trim() }))
      else if (res?.emailed === false) toast.warning(t('users.emailFailed', { error: res.email_error ?? t('errors.unexpected') }))
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
              className="sm:col-span-2"
              error={errors.password}
              hint={isEdit ? t('users.passwordHint') : undefined}
            >
              <PasswordField id="u-password" value={password} onChange={setPassword} invalid={!!errors.password} />
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

          <div className="grid gap-2">
            <Field label={t('users.email')} htmlFor="u-email" error={errors.email}>
              <Input
                id="u-email"
                type="email"
                autoComplete="off"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('users.emailPlaceholder')}
                aria-invalid={!!errors.email}
              />
            </Field>
            <div className="grid gap-1">
              <label className={cn('flex items-center gap-2.5 text-sm', canEmail ? 'cursor-pointer' : 'text-muted-foreground cursor-not-allowed')}>
                <Checkbox checked={canEmail && emailPassword} disabled={!canEmail} onCheckedChange={(v) => setEmailPassword(v === true)} />
                {t('users.emailPassword')}
              </label>
              {mail.isSuccess && !mailAvailable ? (
                <p className="text-muted-foreground text-xs">
                  {t('users.mailUnavailable')}{' '}
                  <Link to="/notifications" className="text-primary underline-offset-4 hover:underline">
                    {t('users.mailSetup')}
                  </Link>
                </p>
              ) : mailAvailable && !email.trim() ? (
                <p className="text-muted-foreground text-xs">{t('users.emailNeeded')}</p>
              ) : mailAvailable && isEdit && !password ? (
                <p className="text-muted-foreground text-xs">{t('users.emailNeedsPassword')}</p>
              ) : null}
            </div>
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

const RESET_HOURS = ['1', '24', '72', '168'] as const

function ResetLinkDialog({ user, onClose }: { user: ManagedUser; onClose: () => void }) {
  const { t } = useI18n()
  const [hours, setHours] = useState<(typeof RESET_HOURS)[number]>('24')
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<{ url: string; expires: number } | null>(null)

  const generate = async () => {
    setBusy(true)
    try {
      const res = await api.userResetLink(user.id, Number(hours))
      setLink({ url: `${window.location.origin}${res.path}`, expires: res.expires_at })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('users.resetLinkTitle')}</DialogTitle>
          <DialogDescription>{t('users.resetLinkDesc', { name: user.name })}</DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="grid gap-3">
            <div className="flex gap-2">
              <Input readOnly aria-label={t('users.resetLink')} value={link.url} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} autoFocus />
              <CopyButton text={link.url} />
            </div>
            <p className="text-muted-foreground text-xs">{t('users.resetLinkExpires', { when: formatDateTime(link.expires) })}</p>
            <p className="text-muted-foreground text-xs">{t('users.resetLinkNote')}</p>
          </div>
        ) : (
          <Field label={t('users.resetValid')} htmlFor="reset-hours">
            <Select value={hours} onValueChange={(v) => setHours(v as typeof hours)}>
              <SelectTrigger id="reset-hours">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESET_HOURS.map((h) => (
                  <SelectItem key={h} value={h}>
                    {t(`users.hours.${h}` as const)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {link ? t('common.done') : t('common.cancel')}
          </Button>
          {!link && (
            <Button onClick={generate} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {t('users.generate')}
            </Button>
          )}
        </DialogFooter>
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
  const [resetFor, setResetFor] = useState<ManagedUser | null>(null)
  const [signOutFor, setSignOutFor] = useState<ManagedUser | null>(null)
  const [secResetFor, setSecResetFor] = useState<ManagedUser | null>(null)
  const now = useNow(60_000)

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
        <ListCard>
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
              subtitle={u.email ? `@${u.username} · ${u.email}` : `@${u.username}`}
              meta={
                <>
                  {u.two_factor && (
                    <Badge variant="up" title={t('users.twoFactorOn')}>
                      <ShieldCheck />
                      {t('users.twoFactor')}
                    </Badge>
                  )}
                  {(u.passkeys ?? 0) > 0 && (
                    <Badge variant="outline" className="text-muted-foreground font-normal">
                      <KeyRound />
                      {t('users.passkeys', { count: u.passkeys ?? 0 })}
                    </Badge>
                  )}
                  {u.last_seen_at ? (
                    <span className="text-muted-foreground text-xs whitespace-nowrap" title={formatDateTime(u.last_seen_at)}>
                      {t('users.lastActive', { when: formatRelative(u.last_seen_at, now) })}
                    </span>
                  ) : null}
                {u.role === 'superadmin' ? (
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
                )}
                </>
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
                    extra={[
                      { label: t('users.resetLinkAction'), icon: <Link2 />, onSelect: () => setResetFor(u) },
                      { label: t('users.signOutEverywhere'), icon: <LogOut />, onSelect: () => setSignOutFor(u) },
                      { label: t('users.securityReset'), icon: <ShieldOff />, onSelect: () => setSecResetFor(u) },
                    ]}
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

      {resetFor && <ResetLinkDialog user={resetFor} onClose={() => setResetFor(null)} />}
      <ConfirmDialog
        open={!!signOutFor}
        onOpenChange={(o) => !o && setSignOutFor(null)}
        title={t('users.signOutTitle')}
        description={t('users.signOutDesc', { name: signOutFor?.name ?? '' })}
        confirmLabel={t('users.signOutEverywhere')}
        onConfirm={async () => {
          if (!signOutFor) return
          try {
            const res = await api.userRevokeSessions(signOutFor.id)
            toast.success(t('sess.revokedMany', { count: res.revoked ?? 0 }))
            qc.invalidateQueries({ queryKey: ['users'] })
          } catch (e) {
            toast.error(errorMessage(e))
            throw e
          }
        }}
      />
      <ConfirmDialog
        open={!!secResetFor}
        onOpenChange={(o) => !o && setSecResetFor(null)}
        title={t('users.securityResetTitle')}
        description={t('users.securityResetDesc', { name: secResetFor?.name ?? '' })}
        confirmLabel={t('users.securityResetConfirm')}
        onConfirm={async () => {
          if (!secResetFor) return
          try {
            await api.userSecurityReset(secResetFor.id)
            toast.success(t('users.securityResetDone'))
            qc.invalidateQueries({ queryKey: ['users'] })
          } catch (e) {
            toast.error(errorMessage(e))
            throw e
          }
        }}
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
