import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { AuthShell } from '@/components/auth-shell'
import { ErrorNote } from '@/components/error-note'
import { Field } from '@/components/field'
import { PasswordField } from '@/components/password-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useMe, useSetupStatus } from '@/hooks/use-auth'
import { brandKey } from '@/hooks/use-brand'
import { LANGS, useI18n } from '@/i18n'
import { api, ApiError, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'

type Step = 1 | 2 | 3 | 4
const STEP_KEYS = ['setup.s1', 'setup.s2', 'setup.s3', 'setup.s4'] as const

function strength(pw: string): 0 | 1 | 2 {
  if (pw.length < 8) return 0
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length
  return pw.length >= 12 && classes >= 3 ? 2 : 1
}

export function SetupPage() {
  const { t, lang, setLang } = useI18n()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: me, isPending: mePending } = useMe()
  const status = useSetupStatus()
  const [step, setStep] = useState<Step>(1)
  const [created, setCreated] = useState(false)

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [appName, setAppName] = useState('Observi')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // first monitor (step 4)
  const [mName, setMName] = useState('')
  const [mUrl, setMUrl] = useState('')
  const [mBusy, setMBusy] = useState(false)
  const [mDone, setMDone] = useState(false)
  const [mError, setMError] = useState<string | null>(null)

  if (mePending || (status.isPending && !created)) return null
  if (!created && (me || status.data === false)) return <Navigate to={me ? '/dashboard' : '/login'} replace />

  const next1 = () => {
    if (!code.trim()) return setErrors({ code: t('setup.codeRequired') })
    setErrors({})
    setStep(2)
  }
  const next2 = () => {
    const errs: Record<string, string> = {}
    if (!name.trim()) errs.name = t('common.nameRequired')
    if (!/^[A-Za-z0-9._-]+$/.test(username.trim())) errs.username = t('setup.usernameInvalid')
    if (password.length < 8) errs.password = t('settings.pw.tooShort')
    else if (password !== confirm) errs.confirm = t('settings.pw.mismatch')
    setErrors(errs)
    if (!Object.keys(errs).length) setStep(3)
  }

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const user = await api.setup({
        code: code.trim(),
        username: username.trim(),
        name: name.trim(),
        password,
        ...(appName.trim() ? { app_name: appName.trim() } : {}),
      })
      setCreated(true)
      qc.setQueryData(['me'], user)
      qc.setQueryData(['setup-status'], false)
      qc.invalidateQueries({ queryKey: brandKey })
      setStep(4)
    } catch (err) {
      const c = err instanceof ApiError ? err.code : null
      const msg = errorMessage(err)
      if (c === 'setup_code_invalid') {
        setErrors({ code: msg })
        setStep(1)
      } else if (c === 'username_invalid') {
        setErrors({ username: msg })
        setStep(2)
      } else if (c === 'name_required') {
        setErrors({ name: msg })
        setStep(2)
      } else if (c === 'password_too_short') {
        setErrors({ password: msg })
        setStep(2)
      } else if (c === 'setup_done') {
        toast.error(msg)
        qc.setQueryData(['setup-status'], false)
        navigate('/login', { replace: true })
      } else setError(msg)
    } finally {
      setBusy(false)
    }
  }

  const addMonitor = async (e: React.FormEvent) => {
    e.preventDefault()
    setMError(null)
    let url = mUrl.trim()
    if (!mName.trim() || !url) return setMError(t('setup.monitorRequired'))
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`
    setMBusy(true)
    try {
      await api.createMonitor({
        name: mName.trim(),
        type: 'http',
        url,
        method: 'GET',
        interval: 60,
        retry_interval: 60,
        max_retries: 2,
        timeout: 30,
        accepted_status: '200-299',
        ignore_tls: false,
        upside_down: false,
        max_redirects: 10,
        notification_ids: [],
      })
      qc.invalidateQueries({ queryKey: ['monitors'] })
      setMDone(true)
      toast.success(t('setup.monitorAdded'))
    } catch (err) {
      setMError(errorMessage(err))
    } finally {
      setMBusy(false)
    }
  }

  const st = strength(password)
  return (
    <AuthShell wide subtitle={t('setup.subtitle')}>
      <div className="mb-5 grid gap-2">
        <div className="flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step} aria-label={t('setup.step', { n: step, total: 4 })}>
          {[1, 2, 3, 4].map((n) => (
            <span key={n} className={cn('h-1.5 flex-1 rounded-full transition-colors', n <= step ? 'bg-primary' : 'bg-muted')} />
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          {t('setup.step', { n: step, total: 4 })} · <span className="text-foreground font-medium">{t(STEP_KEYS[step - 1])}</span>
        </p>
      </div>

      {step === 1 && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            next1()
          }}
          className="grid gap-4"
          noValidate
        >
          <div>
            <h2 className="text-base font-semibold">{t('setup.welcomeTitle')}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{t('setup.welcomeDesc')}</p>
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm leading-none font-medium">{t('lang.label')}</span>
            <div className="bg-muted inline-flex w-fit rounded-md p-0.5" role="radiogroup" aria-label={t('lang.label')}>
              {LANGS.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  role="radio"
                  aria-checked={lang === l.code}
                  onClick={() => setLang(l.code)}
                  className={cn('text-muted-foreground rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors', lang === l.code && 'bg-background text-foreground shadow-xs')}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          <Field
            label={t('setup.code')}
            htmlFor="setup-code"
            error={errors.code}
            hint={
              <span className="grid gap-1">
                <span>{t('setup.codeHint')}</span>
                <code className="bg-muted/60 block overflow-x-auto rounded-md px-2 py-1 font-mono text-[11px] whitespace-nowrap">journalctl -u observi | grep 'Setup code'</code>
                <span>{t('setup.codeDocker')}</span>
                <code className="bg-muted/60 block overflow-x-auto rounded-md px-2 py-1 font-mono text-[11px] whitespace-nowrap">docker logs observi 2&gt;&amp;1 | grep 'Setup code'</code>
              </span>
            }
          >
            <Input
              id="setup-code"
              autoFocus
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="font-mono"
              value={code}
              onChange={(e) => {
                setCode(e.target.value)
                setErrors({})
              }}
              aria-invalid={!!errors.code}
            />
          </Field>
          <Button type="submit" className="w-full">
            {t('common.next')}
            <ArrowRight />
          </Button>
        </form>
      )}

      {step === 2 && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            next2()
          }}
          className="grid gap-4"
          noValidate
        >
          <div>
            <h2 className="text-base font-semibold">{t('setup.adminTitle')}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{t('setup.adminDesc')}</p>
          </div>
          <Field label={t('setup.name')} htmlFor="setup-name" error={errors.name}>
            <Input id="setup-name" autoFocus autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} />
          </Field>
          <Field label={t('common.username')} htmlFor="setup-username" error={errors.username}>
            <Input id="setup-username" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} aria-invalid={!!errors.username} />
          </Field>
          <Field label={t('common.password')} htmlFor="setup-password" error={errors.password} hint={t('setup.pwHint')}>
            <PasswordField
              id="setup-password"
              value={password}
              onChange={(v) => {
                setPassword(v)
                setErrors((e) => ({ ...e, password: '', confirm: '' }))
              }}
              invalid={!!errors.password}
              onGenerate={setConfirm}
            />
          </Field>
          {password && (
            <div className="-mt-2 flex items-center gap-2" aria-live="polite">
              <div className="flex flex-1 gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className={cn('h-1 flex-1 rounded-full', i <= st ? (st === 0 ? 'bg-down' : st === 1 ? 'bg-pending' : 'bg-up') : 'bg-muted')} />
                ))}
              </div>
              <span className="text-muted-foreground text-xs">{t(st === 0 ? 'setup.strengthWeak' : st === 1 ? 'setup.strengthFair' : 'setup.strengthStrong')}</span>
            </div>
          )}
          <Field label={t('settings.pw.confirm')} htmlFor="setup-confirm" error={errors.confirm}>
            <Input id="setup-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!errors.confirm} />
          </Field>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setStep(1)}>
              <ArrowLeft />
              {t('common.back')}
            </Button>
            <Button type="submit" className="flex-1">
              {t('common.next')}
              <ArrowRight />
            </Button>
          </div>
        </form>
      )}

      {step === 3 && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
          className="grid gap-4"
        >
          <div>
            <h2 className="text-base font-semibold">{t('setup.instanceTitle')}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{t('setup.instanceDesc')}</p>
          </div>
          <Field label={t('setup.appName')} htmlFor="setup-app" hint={t('common.optional')}>
            <Input id="setup-app" autoFocus maxLength={40} value={appName} onChange={(e) => setAppName(e.target.value)} />
          </Field>
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setStep(2)} disabled={busy}>
              <ArrowLeft />
              {t('common.back')}
            </Button>
            <Button type="submit" className="flex-1" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {t('setup.create')}
            </Button>
          </div>
        </form>
      )}

      {step === 4 && (
        <div className="grid gap-4">
          <div className="flex items-start gap-3">
            <span className="bg-up/10 text-up grid size-9 shrink-0 place-items-center rounded-lg">
              <CheckCircle2 className="size-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold">{t('setup.doneTitle')}</h2>
              <p className="text-muted-foreground mt-0.5 text-sm">{t('setup.doneDesc')}</p>
            </div>
          </div>
          <div className="rounded-xl border p-3.5">
            <h3 className="text-sm font-semibold">{t('setup.firstMonitor')}</h3>
            {mDone ? (
              <p className="text-up mt-2 flex items-center gap-1.5 text-sm">
                <CheckCircle2 className="size-4" />
                {t('setup.monitorAdded')}
              </p>
            ) : (
              <form onSubmit={addMonitor} className="mt-2.5 grid gap-2.5" noValidate>
                <Input aria-label={t('common.name')} placeholder={t('setup.monitorName')} value={mName} onChange={(e) => setMName(e.target.value)} />
                <Input aria-label="URL" placeholder="https://example.com" inputMode="url" autoCapitalize="none" value={mUrl} onChange={(e) => setMUrl(e.target.value)} />
                {mError && <p className="text-destructive text-xs">{mError}</p>}
                <Button type="submit" size="sm" variant="outline" disabled={mBusy} className="w-fit">
                  {mBusy ? <Loader2 className="animate-spin" /> : <Plus />}
                  {t('setup.addMonitor')}
                </Button>
              </form>
            )}
          </div>
          <div className="rounded-xl border p-3.5">
            <h3 className="text-sm font-semibold">{t('setup.notifTitle')}</h3>
            <p className="text-muted-foreground mt-1 text-xs">{t('setup.notifDesc')}</p>
            <Button size="sm" variant="outline" className="mt-2.5" onClick={() => navigate('/notifications')}>
              {t('setup.notifLink')}
            </Button>
          </div>
          <Button className="w-full" onClick={() => navigate('/dashboard', { replace: true })}>
            {t('setup.finish')}
            <ArrowRight />
          </Button>
        </div>
      )}
    </AuthShell>
  )
}
