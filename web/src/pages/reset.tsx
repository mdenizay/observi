import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Link2Off, Loader2 } from 'lucide-react'
import { AuthShell } from '@/components/auth-shell'
import { ErrorNote } from '@/components/error-note'
import { Field } from '@/components/field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n'
import { api, errorMessage } from '@/lib/api'

export function ResetPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const check = useQuery({
    queryKey: ['reset', token],
    queryFn: () => api.resetCheck(token),
    enabled: !!token,
    retry: false,
    staleTime: Infinity,
  })
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (password.length < 8) errs.password = t('settings.pw.tooShort')
    if (password !== confirm) errs.confirm = t('settings.pw.mismatch')
    setErrors(errs)
    setError(null)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      await api.resetPassword(token, password)
      setDone(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const invalid = !token || check.isError || (check.data && !check.data.valid)

  return (
    <AuthShell subtitle={t('reset.subtitle')}>
      {check.isPending && token ? (
        <div className="grid gap-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : invalid ? (
        <div className="grid justify-items-center gap-3 text-center">
          <span className="bg-down/10 text-down grid size-11 place-items-center rounded-full">
            <Link2Off className="size-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">{t('reset.invalidTitle')}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{t('reset.invalidDesc')}</p>
          </div>
          <Button asChild variant="outline" className="w-full">
            <Link to="/login">{t('reset.toSignIn')}</Link>
          </Button>
        </div>
      ) : done ? (
        <div className="grid justify-items-center gap-3 text-center">
          <span className="bg-up/10 text-up grid size-11 place-items-center rounded-full">
            <CheckCircle2 className="size-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">{t('reset.doneTitle')}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{t('reset.doneDesc')}</p>
          </div>
          <Button className="w-full" onClick={() => navigate('/login', { replace: true })}>
            {t('login.submit')}
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="grid gap-4">
          <h2 className="text-sm font-semibold">{t('reset.title', { name: check.data?.name ?? '' })}</h2>
          <Field label={t('settings.pw.new')} htmlFor="reset-pw" error={errors.password} hint={t('reset.hint')}>
            <Input
              id="reset-pw"
              type="password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!errors.password}
            />
          </Field>
          <Field label={t('settings.pw.confirm')} htmlFor="reset-confirm" error={errors.confirm}>
            <Input
              id="reset-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={!!errors.confirm}
            />
          </Field>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy && <Loader2 className="animate-spin" />}
            {t('reset.submit')}
          </Button>
        </form>
      )}
    </AuthShell>
  )
}
