import { useState } from 'react'
import { Eye, EyeOff, Wand2 } from 'lucide-react'
import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { generatePassword } from '@/lib/password'

/** Password input with show/hide, a "Generate" button and (once filled) a copy button. */
export function PasswordField({
  id,
  value,
  onChange,
  autoComplete = 'new-password',
  invalid,
  onGenerate,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  autoComplete?: string
  invalid?: boolean
  /** Called with a freshly generated password (e.g. to also fill a confirmation field). */
  onGenerate?: (pw: string) => void
}) {
  const { t } = useI18n()
  const [show, setShow] = useState(false)
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative min-w-0 flex-1">
        <Input
          id={id}
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
          className={show ? 'pr-9 font-mono' : 'pr-9'}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? t('pw.hide') : t('pw.show')}
          title={show ? t('pw.hide') : t('pw.show')}
          aria-pressed={show}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-md outline-none focus-visible:ring-2"
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {value && <CopyButton text={value} iconOnly />}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-9 shrink-0"
        title={t('pw.generateTip')}
        onClick={() => {
          const pw = generatePassword()
          onChange(pw)
          onGenerate?.(pw)
          setShow(true)
        }}
      >
        <Wand2 />
        <span className="max-sm:sr-only">{t('pw.generate')}</span>
      </Button>
    </div>
  )
}
