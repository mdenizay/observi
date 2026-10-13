import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { LanguageSwitcher } from '@/components/language-switcher'
import { BrandMark } from '@/components/logo'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useMe } from '@/hooks/use-auth'
import { useBrand } from '@/hooks/use-brand'
import { api, ApiError, errorMessage } from '@/lib/api'
import { useI18n } from '@/i18n'

export function LoginPage() {
  const { t } = useI18n()
  const { name } = useBrand()
  const { data: me } = useMe()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  const target = from && from.startsWith('/') && !from.startsWith('/login') ? from : '/dashboard'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (me) return <Navigate to={target} replace />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const user = await api.login(username.trim(), password)
      qc.setQueryData(['me'], user)
      navigate(target, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t('errors.invalid_credentials') : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden p-4">
      <div
        aria-hidden
        className="graticule pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_60%_55%_at_50%_42%,black,transparent_80%)]"
      />
      <div
        aria-hidden
        className="bg-primary/20 pointer-events-none absolute top-[18%] left-1/2 size-[34rem] -translate-x-1/2 rounded-full opacity-60 blur-[120px] dark:opacity-40"
      />
      <div className="absolute top-4 right-4 z-10 flex items-center gap-1">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark className="shadow-raised size-11 rounded-xl" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
            <p className="text-muted-foreground text-sm">{t('login.subtitle')}</p>
          </div>
        </div>
        <Card className="shadow-pop rounded-2xl py-6">
          <CardContent className="px-6">
            <form onSubmit={submit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="username">{t('common.username')}</Label>
                <Input
                  id="username"
                  autoComplete="username"
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
              {error && (
                <p className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={busy} className="w-full">
                {busy && <Loader2 className="animate-spin" />}
                {t('login.submit')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
