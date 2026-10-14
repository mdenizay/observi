import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { copyText } from '@/lib/clipboard'

export function CopyButton({
  text,
  label,
  iconOnly,
  variant = 'outline',
}: {
  text: string
  label?: string
  iconOnly?: boolean
  variant?: 'outline' | 'ghost' | 'secondary'
}) {
  const { t } = useI18n()
  const [done, setDone] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const text_ = label ?? t('common.copy')
  return (
    <Button
      type="button"
      size={iconOnly ? 'icon-sm' : 'sm'}
      variant={variant}
      aria-label={iconOnly ? text_ : undefined}
      title={iconOnly ? text_ : undefined}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => setDone(false), 1800)
        } else toast.error(t('common.copyFailed'))
      }}
    >
      {done ? <Check className="text-up" /> : <Copy />}
      {!iconOnly && (done ? t('common.copied') : text_)}
    </Button>
  )
}
