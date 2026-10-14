import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2, LogOut, MonitorSmartphone, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import { Field } from '@/components/field'
import { RecoveryCodes } from '@/components/recovery-codes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useNow } from '@/hooks/use-now'
import { translateDynamic, useI18n } from '@/i18n'
import { api, errorMessage } from '@/lib/api'
import { formatDateTime, formatRelative } from '@/lib/format'
import { createCredential, isPasskeyCancel, passkeyErrorMessage, supportsPasskeys } from '@/lib/webauthn'
import { cn } from '@/lib/utils'

const securityKey = ['security']

/* ------------------------------------------------------------ two-factor */

type SetupData = { secret: string; otpauth_url: string; qr_svg: string }

function SetupDialog({ data, onClose }: { data: SetupData; onClose: () => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [codes, setCodes] = useState<string[]>([])

  const enable = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await api.twoFaEnable(code.trim())
      setCodes(res.recovery_codes)
      setStep(3)
      qc.invalidateQueries({ queryKey: securityKey })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && step !== 3 && onClose()}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => step === 3 && e.preventDefault()} onEscapeKeyDown={(e) => step === 3 && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('twofa.setupTitle')}</DialogTitle>
          <DialogDescription>{t('twofa.stepOf', { n: step, total: 3 })}</DialogDescription>
        </DialogHeader>
        {step === 1 && (
          <div className="grid gap-4">
            <p className="text-muted-foreground text-sm">{t('twofa.scanDesc')}</p>
            <div className="mx-auto w-fit rounded-xl border bg-white p-3">
              {/* The SVG is server generated; as an <img> it can never run script. */}
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(data.qr_svg)}`}
                alt={t('twofa.qrAlt')}
                className="size-44"
              />
            </div>
            <Field label={t('twofa.secret')} htmlFor="twofa-secret" hint={t('twofa.secretHint')}>
              <div className="flex gap-2">
                <Input id="twofa-secret" readOnly value={data.secret} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                <CopyButton text={data.secret} />
              </div>
            </Field>
            <a href={data.otpauth_url} className="text-primary text-sm underline-offset-4 hover:underline">
              {t('twofa.openApp')}
            </a>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => setStep(2)}>{t('common.next')}</Button>
            </DialogFooter>
          </div>
        )}
        {step === 2 && (
          <form onSubmit={enable} className="grid gap-4" noValidate>
            <Field label={t('twofa.enterCode')} htmlFor="twofa-code" error={error} hint={t('twofa.enterCodeHint')}>
              <Input
                id="twofa-code"
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                className="num text-center text-lg tracking-[0.4em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                aria-invalid={!!error}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStep(1)}>
                {t('common.back')}
              </Button>
              <Button type="submit" disabled={busy || code.length !== 6}>
                {busy && <Loader2 className="animate-spin" />}
                {t('twofa.enable')}
              </Button>
            </DialogFooter>
          </form>
        )}
        {step === 3 && <RecoveryCodes codes={codes} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

/** Asks for the account password and a code; used to turn two-factor off or regenerate recovery codes. */
function ReauthDialog({
  mode,
  onClose,
  onCodes,
}: {
  mode: 'disable' | 'regen'
  onClose: () => void
  onCodes: (codes: string[]) => void
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const disable = mode === 'disable'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (disable) {
        await api.twoFaDisable(password, code.trim())
        toast.success(t('twofa.disabled'))
        qc.invalidateQueries({ queryKey: securityKey })
        onClose()
      } else {
        const res = await api.twoFaRecoveryCodes(password, code.trim())
        qc.invalidateQueries({ queryKey: securityKey })
        onCodes(res.recovery_codes)
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{disable ? t('twofa.disableTitle') : t('twofa.regenTitle')}</DialogTitle>
          <DialogDescription>{disable ? t('twofa.disableDesc') : t('twofa.regenDesc')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <Field label={t('settings.pw.current')} htmlFor="reauth-pw">
            <Input id="reauth-pw" type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label={t('twofa.codeOrRecovery')} htmlFor="reauth-code" error={error}>
            <Input
              id="reauth-code"
              autoComplete="one-time-code"
              autoCapitalize="none"
              spellCheck={false}
              className="font-mono"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-invalid={!!error}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant={disable ? 'destructive' : 'default'} disabled={busy || !password || !code.trim()}>
              {busy && <Loader2 className="animate-spin" />}
              {disable ? t('twofa.turnOff') : t('twofa.regenerate')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function TwoFactorCard() {
  const { t } = useI18n()
  const q = useQuery({ queryKey: securityKey, queryFn: api.security })
  const [setup, setSetup] = useState<SetupData | null>(null)
  const [starting, setStarting] = useState(false)
  const [reauth, setReauth] = useState<'disable' | 'regen' | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const enabled = q.data?.two_factor.enabled ?? false
  const remaining = q.data?.two_factor.recovery_remaining ?? 0

  const start = async () => {
    setStarting(true)
    try {
      setSetup(await api.twoFaSetup())
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setStarting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1.5">
            <CardTitle className="text-base">{t('twofa.title')}</CardTitle>
            <CardDescription>{t('twofa.desc')}</CardDescription>
          </div>
          {q.data && (
            <Badge variant={enabled ? 'up' : 'muted'} className="shrink-0">
              {enabled ? <ShieldCheck /> : <ShieldOff />}
              {enabled ? t('twofa.on') : t('twofa.off')}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {q.isPending ? (
          <Skeleton className="h-9 w-40" />
        ) : q.isError ? (
          <p className="text-muted-foreground text-sm">{errorMessage(q.error)}</p>
        ) : enabled ? (
          <>
            <p className={cn('text-sm', remaining <= 3 ? 'text-pending font-medium' : 'text-muted-foreground')}>
              {t('twofa.remaining', { count: remaining })}
              {remaining <= 3 && ` ${t('twofa.remainingLow')}`}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setReauth('regen')}>
                {t('twofa.regenerate')}
              </Button>
              <Button variant="outline" onClick={() => setReauth('disable')}>
                {t('twofa.turnOff')}
              </Button>
            </div>
          </>
        ) : (
          <div>
            <Button onClick={start} disabled={starting}>
              {starting && <Loader2 className="animate-spin" />}
              {t('twofa.setUp')}
            </Button>
          </div>
        )}
      </CardContent>
      {setup && <SetupDialog data={setup} onClose={() => setSetup(null)} />}
      {reauth && <ReauthDialog mode={reauth} onClose={() => setReauth(null)} onCodes={(c) => (setReauth(null), setCodes(c))} />}
      {codes && (
        <Dialog open onOpenChange={() => undefined}>
          <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>{t('twofa.newCodes')}</DialogTitle>
              <DialogDescription>{t('twofa.newCodesDesc')}</DialogDescription>
            </DialogHeader>
            <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />
          </DialogContent>
        </Dialog>
      )}
    </Card>
  )
}

/* -------------------------------------------------------------- passkeys */

export function PasskeysCard() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const now = useNow(60_000)
  const q = useQuery({ queryKey: ['passkeys'], queryFn: api.passkeys })
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [toRemove, setToRemove] = useState<{ id: string; name: string } | null>(null)
  const supported = supportsPasskeys()

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const opts = await api.passkeyRegisterOptions()
      const credential = await createCredential(opts.publicKey)
      await api.passkeyRegister(opts.challenge_id, name.trim() || undefined, credential)
      toast.success(t('passkey.added'))
      setName('')
      qc.invalidateQueries({ queryKey: ['passkeys'] })
      qc.invalidateQueries({ queryKey: securityKey })
    } catch (err) {
      if (isPasskeyCancel(err)) return
      toast.error(passkeyErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const items = q.data?.items ?? []
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('passkey.title')}</CardTitle>
        <CardDescription>{t('passkey.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {q.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : items.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('passkey.empty')}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {items.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                <KeyRound className="text-muted-foreground size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="text-muted-foreground truncate text-xs">
                    <span title={formatDateTime(p.created_at)}>{t('passkey.created', { when: formatRelative(p.created_at, now) })}</span>
                    {' · '}
                    {p.last_used_at ? (
                      <span title={formatDateTime(p.last_used_at)}>{t('passkey.lastUsed', { when: formatRelative(p.last_used_at, now) })}</span>
                    ) : (
                      t('passkey.neverUsed')
                    )}
                  </div>
                </div>
                <Button size="icon-sm" variant="ghost" aria-label={t('passkey.remove')} title={t('passkey.remove')} onClick={() => setToRemove(p)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {supported ? (
          <form onSubmit={add} className="flex flex-wrap items-end gap-2">
            <Field label={t('passkey.name')} htmlFor="passkey-name" className="min-w-40 flex-1">
              <Input id="passkey-name" value={name} maxLength={40} placeholder={t('passkey.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
              {t('passkey.add')}
            </Button>
          </form>
        ) : (
          <p className="text-muted-foreground bg-muted/50 rounded-lg px-3 py-2.5 text-sm">{t('passkey.unsupported')}</p>
        )}
      </CardContent>
      <ConfirmDialog
        open={!!toRemove}
        onOpenChange={(o) => !o && setToRemove(null)}
        title={t('passkey.removeTitle')}
        description={t('passkey.removeDesc', { name: toRemove?.name ?? '' })}
        confirmLabel={t('passkey.remove')}
        onConfirm={async () => {
          if (!toRemove) return
          try {
            await api.deletePasskey(toRemove.id)
            toast.success(t('passkey.removed'))
            qc.invalidateQueries({ queryKey: ['passkeys'] })
            qc.invalidateQueries({ queryKey: securityKey })
          } catch (err) {
            toast.error(errorMessage(err))
            throw err
          }
        }}
      />
    </Card>
  )
}

/* -------------------------------------------------------------- sessions */

export function SessionsCard() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const now = useNow(30_000)
  const q = useQuery({ queryKey: ['sessions'], queryFn: api.sessions })
  const [toRevoke, setToRevoke] = useState<string | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  const items = q.data?.items ?? []
  const others = items.filter((s) => !s.current).length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('sess.title')}</CardTitle>
        <CardDescription>{t('sess.desc')}</CardDescription>
      </CardHeader>
      <CardContent>
        {q.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : q.isError ? (
          <p className="text-muted-foreground text-sm">{errorMessage(q.error)}</p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto rounded-lg border">
            {items.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                <MonitorSmartphone className="text-muted-foreground size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-sm font-medium">{s.device || t('sess.unknownDevice')}</span>
                    {s.current && <Badge variant="up">{t('sess.thisDevice')}</Badge>}
                    {s.method && (
                      <Badge variant="outline" className="text-muted-foreground font-normal">
                        {translateDynamic(`sess.method.${s.method}`) ?? s.method}
                      </Badge>
                    )}
                  </div>
                  <div className="text-muted-foreground truncate text-xs">
                    {s.ip && <span className="num">{s.ip} · </span>}
                    {s.last_seen_at > 0 ? (
                      <span title={formatDateTime(s.last_seen_at)}>{t('sess.lastActive', { when: formatRelative(s.last_seen_at, now) })}</span>
                    ) : (
                      t('sess.unknownActivity')
                    )}
                    {s.created_at > 0 && (
                      <span title={formatDateTime(s.created_at)} className="hidden sm:inline">
                        {' · '}
                        {t('sess.signedIn', { when: formatRelative(s.created_at, now) })}
                      </span>
                    )}
                  </div>
                </div>
                <Button size="sm" variant="ghost" disabled={s.current} onClick={() => setToRevoke(s.id)} title={s.current ? t('sess.currentHint') : undefined}>
                  <LogOut />
                  {t('sess.signOut')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <CardFooter className="justify-end">
        <Button variant="outline" disabled={others === 0} onClick={() => setConfirmAll(true)}>
          {t('sess.signOutOthers')}
        </Button>
      </CardFooter>
      <ConfirmDialog
        open={!!toRevoke}
        onOpenChange={(o) => !o && setToRevoke(null)}
        title={t('sess.revokeTitle')}
        description={t('sess.revokeDesc')}
        confirmLabel={t('sess.signOut')}
        onConfirm={async () => {
          if (!toRevoke) return
          try {
            await api.revokeSession(toRevoke)
            toast.success(t('sess.revoked'))
            qc.invalidateQueries({ queryKey: ['sessions'] })
          } catch (err) {
            toast.error(errorMessage(err))
            throw err
          }
        }}
      />
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={t('sess.revokeAllTitle')}
        description={t('sess.revokeAllDesc')}
        confirmLabel={t('sess.signOutOthers')}
        onConfirm={async () => {
          try {
            const { revoked } = await api.revokeOtherSessions()
            toast.success(t('sess.revokedMany', { count: revoked }))
            qc.invalidateQueries({ queryKey: ['sessions'] })
          } catch (err) {
            toast.error(errorMessage(err))
            throw err
          }
        }}
      />
    </Card>
  )
}
