import { useState } from 'react'
import { Download } from 'lucide-react'
import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogFooter } from '@/components/ui/dialog'
import { useBrand } from '@/hooks/use-brand'
import { useUser } from '@/hooks/use-auth'
import { useI18n } from '@/i18n'

/** Shows freshly generated recovery codes once; the user must confirm they saved them. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useI18n()
  const { name } = useBrand()
  const me = useUser()
  const [saved, setSaved] = useState(false)

  const download = () => {
    const body = `${name} — ${t('twofa.codesFileTitle')}\n${me.username} — ${new Date().toISOString().slice(0, 10)}\n\n${codes.join('\n')}\n`
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'account'}-recovery-codes.txt`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground text-sm">{t('twofa.codesDesc')}</p>
      <ul className="bg-muted/50 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border p-4 font-mono text-sm" aria-label={t('twofa.codes')}>
        {codes.map((c) => (
          <li key={c} className="select-all">
            {c}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={codes.join('\n')} label={t('twofa.copyAll')} />
        <Button type="button" size="sm" variant="outline" onClick={download}>
          <Download />
          {t('twofa.download')}
        </Button>
      </div>
      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
        <Checkbox checked={saved} onCheckedChange={(v) => setSaved(v === true)} className="mt-0.5" />
        {t('twofa.savedConfirm')}
      </label>
      <DialogFooter>
        <Button disabled={!saved} onClick={onDone}>
          {t('common.done')}
        </Button>
      </DialogFooter>
    </div>
  )
}
