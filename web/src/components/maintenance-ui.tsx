import { useState } from 'react'
import { BellOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useI18n, type Key } from '@/i18n'
import { maintenanceTip } from '@/lib/maintenance'
import type { MaintenanceInfo } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Small bell-off badge for monitors whose notifications are muted (status stays normal). */
export function MuteBadge({ info, className }: { info: MaintenanceInfo | null | undefined; className?: string }) {
  const { t } = useI18n()
  if (!info || info.kind !== 'mute') return null
  const tip = maintenanceTip(info, t)
  return (
    <span
      title={tip}
      aria-label={tip}
      className={cn('text-muted-foreground inline-flex size-[22px] shrink-0 items-center justify-center rounded-full border', className)}
    >
      <BellOff className="size-3" />
    </span>
  )
}

const PRESETS: { min: number; key: Key }[] = [
  { min: 30, key: 'maint.d30' },
  { min: 60, key: 'maint.d60' },
  { min: 240, key: 'maint.d240' },
  { min: 1440, key: 'maint.d1440' },
]

/** Duration picker + "mute only" switch used by the bulk bar and the drawer. */
export function MaintenanceForm({
  onApply,
  busy,
  idPrefix,
}: {
  onApply: (durationMin: number, muteOnly: boolean) => void
  busy?: boolean
  idPrefix: string
}) {
  const { t } = useI18n()
  const [preset, setPreset] = useState<number | 'custom'>(60)
  const [custom, setCustom] = useState('90')
  const [mute, setMute] = useState(false)
  const minutes = preset === 'custom' ? Number(custom) : preset
  const valid = Number.isInteger(minutes) && minutes >= 1 && minutes <= 60 * 24 * 30

  return (
    <form
      className="grid gap-3 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onApply(minutes, mute)
      }}
    >
      <div className="grid gap-1.5">
        <span className="text-xs font-medium">{t('maint.pickDuration')}</span>
        <div role="radiogroup" aria-label={t('maint.pickDuration')} className="grid grid-cols-2 gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.min}
              type="button"
              role="radio"
              aria-checked={preset === p.min}
              onClick={() => setPreset(p.min)}
              className={cn(
                'hover:bg-accent focus-visible:ring-ring/50 h-8 rounded-md border px-2 text-sm outline-none focus-visible:ring-[3px]',
                preset === p.min && 'border-foreground/60 bg-accent font-medium',
              )}
            >
              {t(p.key)}
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={preset === 'custom'}
            onClick={() => setPreset('custom')}
            className={cn(
              'hover:bg-accent focus-visible:ring-ring/50 col-span-2 h-8 rounded-md border px-2 text-sm outline-none focus-visible:ring-[3px]',
              preset === 'custom' && 'border-foreground/60 bg-accent font-medium',
            )}
          >
            {t('maint.custom')}
          </button>
        </div>
        {preset === 'custom' && (
          <Input
            inputMode="numeric"
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/\D/g, ''))}
            aria-label={t('maint.custom')}
            aria-invalid={!valid}
            className="h-8"
            autoFocus
          />
        )}
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <Label htmlFor={`${idPrefix}-mute`} className="cursor-pointer text-sm">
            {t('maint.muteOnly')}
          </Label>
          <p className="text-muted-foreground text-xs leading-snug">{t('maint.muteOnlyHelp')}</p>
        </div>
        <Switch id={`${idPrefix}-mute`} checked={mute} onCheckedChange={setMute} />
      </div>
      <Button type="submit" size="sm" disabled={!valid || busy}>
        {t('maint.start')}
      </Button>
    </form>
  )
}
