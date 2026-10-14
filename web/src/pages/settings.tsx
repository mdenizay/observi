import { useEffect, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app-shell'
import { Field } from '@/components/field'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LogoMark } from '@/components/logo'
import { ReleaseNotes } from '@/components/release-notes'
import { UpdatesCard } from '@/components/updates-card'
import { meKey, useIsAdmin, useUser } from '@/hooks/use-auth'
import { brandKey, useBrand } from '@/hooks/use-brand'
import type { Brand } from '@/lib/brand'
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

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
const LOGO_MAX = 512 * 1024

function BrandingCard() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const brand = useBrand()
  const [name, setName] = useState(brand.name)
  const [nameError, setNameError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const apply = (b: Brand) => qc.setQueryData(brandKey, b)

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault()
    const v = name.trim()
    if (!v) {
      setNameError(t('common.nameRequired'))
      return
    }
    setNameError(null)
    setSaving(true)
    try {
      const res = await api.updateBrandName(v)
      apply(res)
      setName(res.name)
      toast.success(t('brand.saved'))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const upload = async (file: File | undefined) => {
    if (!file) return
    if (!LOGO_TYPES.includes(file.type)) return void toast.error(t('errors.logo_type_unsupported'))
    if (file.size > LOGO_MAX) return void toast.error(t('errors.logo_too_large'))
    setUploading(true)
    try {
      apply(await api.uploadLogo(file))
      toast.success(t('brand.logoUpdated'))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const removeLogo = async () => {
    setUploading(true)
    try {
      apply(await api.deleteLogo())
      toast.success(t('brand.logoRemoved'))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('brand.title')}</CardTitle>
        <CardDescription>{t('brand.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <form onSubmit={saveName} noValidate className="flex items-start gap-2">
          <Field label={t('brand.name')} htmlFor="brand-name" error={nameError} className="flex-1">
            <Input
              id="brand-name"
              value={name}
              maxLength={40}
              onChange={(e) => {
                setName(e.target.value)
                setNameError(null)
              }}
              aria-invalid={!!nameError}
            />
          </Field>
          <Button type="submit" disabled={saving || name.trim() === brand.name} className="mt-[1.375rem]">
            {saving && <Loader2 className="animate-spin" />}
            {t('common.save')}
          </Button>
        </form>

        <div className="grid gap-1.5">
          <span className="text-sm leading-none font-medium">{t('brand.logo')}</span>
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              void upload(e.dataTransfer.files[0])
            }}
            className={cn(
              'flex flex-col items-center gap-3 rounded-lg border border-dashed p-4 text-center transition-colors sm:flex-row sm:text-left',
              dragging && 'border-primary bg-accent/50',
            )}
          >
            {brand.logo ? (
              <span className="bg-card inline-flex size-16 shrink-0 overflow-hidden rounded-xl border">
                <img src={brand.logo} alt={t('brand.currentLogo')} className="size-full object-contain" />
              </span>
            ) : (
              <LogoMark className="size-16" />
            )}
            <div className="grid min-w-0 flex-1 gap-2">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
                  {t('brand.upload')}
                </Button>
                {brand.logo && (
                  <Button type="button" size="sm" variant="ghost" disabled={uploading} onClick={removeLogo}>
                    <Trash2 />
                    {t('brand.remove')}
                  </Button>
                )}
                <span className="text-muted-foreground text-xs">{t('brand.drop')}</span>
              </div>
              <p className="text-muted-foreground text-xs">{t('brand.hint')}</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={LOGO_TYPES.join(',')}
              className="hidden"
              onChange={(e) => void upload(e.target.files?.[0])}
            />
          </div>
        </div>
      </CardContent>
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

function AccountCard() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const me = useUser()
  const [name, setName] = useState(me.name)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const v = name.trim()
    if (!v) return setError(t('common.nameRequired'))
    setError(null)
    setSaving(true)
    try {
      const user = await api.updateProfile(v)
      qc.setQueryData(meKey, user)
      setName(user.name)
      toast.success(t('profile.saved'))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('profile.title')}</CardTitle>
        <CardDescription>{t('profile.desc')}</CardDescription>
      </CardHeader>
      <form onSubmit={submit} noValidate className="contents">
        <CardContent className="grid gap-4">
          <Field label={t('profile.name')} htmlFor="profile-name" error={error}>
            <Input
              id="profile-name"
              value={name}
              maxLength={80}
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
              aria-invalid={!!error}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('profile.username')} htmlFor="profile-username">
              <Input id="profile-username" value={me.username} readOnly disabled />
            </Field>
            <Field label={t('profile.role')} htmlFor="profile-role">
              <Input
                id="profile-role"
                value={me.role === 'superadmin' ? t('role.superadmin') : t('role.user')}
                readOnly
                disabled
              />
            </Field>
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={saving || name.trim() === me.name}>
            {saving && <Loader2 className="animate-spin" />}
            {t('common.save')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

type TabId = 'profile' | 'branding' | 'updates'

/** Underline-style tabs with tablist semantics and arrow-key navigation. */
function Tabs({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: TabId; label: string }[]
  value: TabId
  onChange: (id: TabId) => void
  label: string
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((x) => x.id === value)
    let n = -1
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') n = 0
    else if (e.key === 'End') n = tabs.length - 1
    if (n < 0) return
    e.preventDefault()
    onChange(tabs[n].id)
    refs.current[tabs[n].id]?.focus()
  }
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="scrollbar-thin mb-5 flex gap-1 overflow-x-auto border-b">
      {tabs.map((tab) => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[tab.id] = el
            }}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={active}
            aria-controls={`panel-${tab.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              'focus-visible:ring-ring/50 relative -mb-px shrink-0 rounded-t-md px-3.5 py-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px]',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
            <span
              className={cn('absolute inset-x-2 bottom-0 h-0.5 rounded-full transition-colors', active ? 'bg-foreground' : 'bg-transparent')}
              aria-hidden
            />
          </button>
        )
      })}
    </div>
  )
}

export function SettingsPage() {
  const { t } = useI18n()
  const isAdmin = useIsAdmin()
  const [params, setParams] = useSearchParams()
  const { hash } = useLocation()

  const tabs: { id: TabId; label: string }[] = [
    { id: 'profile', label: t('settings.tab.profile') },
    ...(isAdmin
      ? ([
          { id: 'branding', label: t('settings.tab.branding') },
          { id: 'updates', label: t('settings.tab.updates') },
        ] as { id: TabId; label: string }[])
      : []),
  ]
  const requested = (params.get('tab') ?? (hash === '#updates' ? 'updates' : 'profile')) as TabId
  const tab = tabs.some((x) => x.id === requested) ? requested : 'profile'

  // Normalise `/settings#updates` to `/settings?tab=updates` so the state survives reloads.
  useEffect(() => {
    if (!params.get('tab') && hash === '#updates' && isAdmin) setParams({ tab: 'updates' }, { replace: true })
  }, [hash, params, isAdmin, setParams])

  return (
    <div>
      <PageHeader title={t('settings.title')} />
      <Tabs
        tabs={tabs}
        value={tab}
        onChange={(id) => setParams(id === 'profile' ? {} : { tab: id }, { replace: true })}
        label={t('settings.tabs')}
      />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0} className="outline-none">
        {tab === 'profile' && (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <AccountCard />
            <PasswordCard />
            <LanguageCard />
          </div>
        )}
        {tab === 'branding' && isAdmin && (
          <BrandingCard />
        )}
        {tab === 'updates' && isAdmin && (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <UpdatesCard />
            <ReleaseNotes />
          </div>
        )}
      </div>
    </div>
  )
}
