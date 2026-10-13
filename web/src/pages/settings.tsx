import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app-shell'
import { Field } from '@/components/field'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { api, ApiError, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { LANGS, useI18n } from '@/i18n'

function PasswordCard() {
  const { t } = useI18n()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!current) errs.current = t('settings.pw.enterCurrent')
    if (next.length < 8) errs.next = t('settings.pw.tooShort')
    if (next !== confirm) errs.confirm = t('settings.pw.mismatch')
    setErrors(errs)
    if (Object.keys(errs).length) return
    setSaving(true)
    try {
      await api.changePassword(current, next)
      toast.success(t('settings.pw.success'))
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      // 400/403 here usually means the current password is wrong
      if (err instanceof ApiError && (err.status === 400 || err.status === 403))
        setErrors({ current: errorMessage(err) })
      else toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('settings.pw.title')}</CardTitle>
        <CardDescription>{t('settings.pw.desc')}</CardDescription>
      </CardHeader>
      <form onSubmit={submit} noValidate className="contents">
        <CardContent className="grid gap-4">
          <Field label={t('settings.pw.current')} htmlFor="pw-current" error={errors.current}>
            <Input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              aria-invalid={!!errors.current}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('settings.pw.new')} htmlFor="pw-new" error={errors.next}>
              <Input
                id="pw-new"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                aria-invalid={!!errors.next}
              />
            </Field>
            <Field label={t('settings.pw.confirm')} htmlFor="pw-confirm" error={errors.confirm}>
              <Input
                id="pw-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                aria-invalid={!!errors.confirm}
              />
            </Field>
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {t('settings.pw.submit')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

function LanguageCard() {
  const { t, lang, setLang } = useI18n()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('lang.label')}</CardTitle>
        <CardDescription>{t('lang.desc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="bg-muted inline-flex rounded-md p-0.5" role="radiogroup" aria-label={t('lang.label')}>
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              role="radio"
              aria-checked={lang === l.code}
              onClick={() => setLang(l.code)}
              className={cn(
                'text-muted-foreground rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors',
                lang === l.code && 'bg-background text-foreground shadow-xs',
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function SettingsPage() {
  const { t } = useI18n()
  return (
    <div>
      <PageHeader title={t('settings.title')} />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <PasswordCard />
        <LanguageCard />
      </div>
    </div>
  )
}
