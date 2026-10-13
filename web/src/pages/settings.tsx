import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app-shell'
import { Field } from '@/components/field'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/panel'
import { Input } from '@/components/ui/input'
import { LogoMark } from '@/components/logo'
import { useIsAdmin } from '@/hooks/use-auth'
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
    <Panel title={t('settings.pw.title')} info={t('settings.pw.desc')} bodyClassName="p-4 grid gap-4">
      <form onSubmit={submit} noValidate className="contents">
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
        <div className="divider-dots" />
        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {t('settings.pw.submit')}
          </Button>
        </div>
      </form>
    </Panel>
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
    <Panel title={t('brand.title')} info={t('brand.desc')} bodyClassName="p-4 grid gap-5">
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
              dragging && 'border-foreground/60 bg-accent/50',
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
      </Panel>
  )
}

function LanguageCard() {
  const { t, lang, setLang } = useI18n()
  return (
    <Panel title={t('lang.label')} info={t('lang.desc')} bodyClassName="p-4">
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
      </Panel>
  )
}

export function SettingsPage() {
  const { t } = useI18n()
  const isAdmin = useIsAdmin()
  return (
    <div>
      <PageHeader title={t('settings.title')} />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <PasswordCard />
        <LanguageCard />
        {isAdmin && (
          <div className="lg:col-span-2">
            <BrandingCard />
          </div>
        )}
      </div>
    </div>
  )
}
