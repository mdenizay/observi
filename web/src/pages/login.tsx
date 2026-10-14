import { useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useMe, useSetupStatus } from '@/hooks/use-auth'
import { api, ApiError, errorMessage } from '@/lib/api'
import { AuthShell } from '@/components/auth-shell'
import { ErrorNote } from '@/components/error-note'
import { useI18n } from '@/i18n'
import type { User } from '@/lib/types'
import { getCredential, isPasskeyCancel, passkeyErrorMessage, supportsPasskeys } from '@/lib/webauthn'

export function LoginPage() {
  const { t } = useI18n()
  const { data: me, isPending: mePending } = useMe()
  const setup = useSetupStatus(!mePending && !me)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  const target = from && from.startsWith('/') && !from.startsWith('/login') ? from : '/dashboard'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  // Second step: set once the server asks for a two-factor code.
  const [challenge, setChallenge] = useState<string | null>(null)
  const [recovery, setRecovery] = useState(false)
  const [code, setCode] = useState('')
  const codeRef = useRef<HTMLInputElement>(null)

  if (me) return <Navigate to={target} replace />
  if (setup.data) return <Navigate to="/setup" replace />

  const done = (user: User) => {
    qc.setQueryData(['me'], user)
    navigate(target, { replace: true })
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await api.login(username.trim(), password)
      if ('needs_2fa' in res) {
        setChallenge(res.challenge)
        setRecovery(false)
        setCode('')
        setPassword('')
      } else done(res)
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t('errors.invalid_credentials') : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const verify = async (value: string) => {
    if (!challenge || busy || !value.trim()) return
    setError(null)
    setBusy(true)
    try {
      done(await api.login2fa(challenge, value.trim()))
    } catch (err) {
      if (err instanceof ApiError && err.code === 'challenge_expired') {
        setChallenge(null)
        setCode('')
        setError(t('errors.challenge_expired'))
      } else {
        setError(errorMessage(err))
        setCode('')
        setTimeout(() => codeRef.current?.focus(), 0)
      }
    } finally {
      setBusy(false)
    }
  }

  const passkeySignIn = async () => {
    setError(null)
    setPasskeyBusy(true)
    try {
      const opts = await api.passkeyLoginOptions(username.trim() || undefined)
      const credential = await getCredential(opts.publicKey)
      done(await api.passkeyLogin(opts.challenge_id, credential))
    } catch (err) {
      if (!isPasskeyCancel(err)) setError(passkeyErrorMessage(err))
    } finally {
      setPasskeyBusy(false)
    }
  }

  const back = () => {
    setChallenge(null)
    setCode('')
    setError(null)
  }

  return (
    <AuthShell>
            {challenge === null ? (
              <form onSubmit={submit} className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="username">{t('common.username')}</Label>
                  <Input
                    id="username"
                    autoComplete="username webauthn"
                    autoCapitalize="none"
                    autoFocus
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="password">{t('common.password')}</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                {error && <ErrorNote>{error}</ErrorNote>}
                <Button type="submit" disabled={busy || passkeyBusy} className="w-full">
                  {busy && <Loader2 className="animate-spin" />}
                  {t('login.submit')}
                </Button>
                {supportsPasskeys() && (
                  <Button type="button" variant="outline" disabled={busy || passkeyBusy} onClick={passkeySignIn} className="w-full">
                    {passkeyBusy ? <Loader2 className="animate-spin" /> : <KeyRound />}
                    {t('login.passkey')}
                  </Button>
                )}
                <p className="text-muted-foreground text-center text-xs">{t('login.forgot')}</p>
              </form>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void verify(code)
                }}
                className="grid gap-4"
              >
                <div className="flex items-start gap-3">
                  <span className="bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-lg">
                    <ShieldCheck className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-sm leading-tight font-semibold">{t('login.twoFactorTitle')}</h2>
                    <p className="text-muted-foreground mt-0.5 text-xs">{recovery ? t('login.recoveryDesc') : t('login.codeDesc')}</p>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="otp">{recovery ? t('login.recoveryLabel') : t('login.codeLabel')}</Label>
                  {recovery ? (
                    <Input
                      key="recovery"
                      id="otp"
                      ref={codeRef}
                      autoFocus
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="xxxxx-xxxxx"
                      className="font-mono"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  ) : (
                    <Input
                      key="totp"
                      id="otp"
                      ref={codeRef}
                      autoFocus
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="000000"
                      className="num text-center text-lg tracking-[0.4em]"
                      value={code}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, '').slice(0, 6)
                        setCode(v)
                        if (v.length === 6) void verify(v)
                      }}
                    />
                  )}
                </div>
                {error && <ErrorNote>{error}</ErrorNote>}
                <Button type="submit" disabled={busy || !code.trim()} className="w-full">
                  {busy && <Loader2 className="animate-spin" />}
                  {t('login.verify')}
                </Button>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <button type="button" onClick={back} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline">
                    <ArrowLeft className="size-3.5" />
                    {t('common.back')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRecovery((r) => !r)
                      setCode('')
                      setError(null)
                    }}
                    className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                  >
                    {recovery ? t('login.useCode') : t('login.useRecovery')}
                  </button>
                </div>
              </form>
            )}
    </AuthShell>
  )
}
