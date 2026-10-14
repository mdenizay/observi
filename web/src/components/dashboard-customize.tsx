import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import type { DashboardPrefs, WidgetId } from '@/lib/dashboard-prefs'
import { cn } from '@/lib/utils'

const labelKey: Record<WidgetId, 'widget.overview' | 'widget.tiles' | 'widget.monitors' | 'widget.expiring' | 'widget.incidents' | 'widget.slowest'> = {
  overview: 'widget.overview',
  tiles: 'widget.tiles',
  monitors: 'widget.monitors',
  expiring: 'widget.expiring',
  incidents: 'widget.incidents',
  slowest: 'widget.slowest',
}

export function CustomizeButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n()
  return (
    <Button type="button" variant="outline" onClick={onClick} className="max-sm:size-9 max-sm:px-0" aria-label={t('custom.title')}>
      <SlidersHorizontal />
      <span className="max-sm:sr-only">{t('custom.button')}</span>
    </Button>
  )
}

export function CustomizeDialog({
  open,
  onOpenChange,
  prefs,
  onChange,
  onReset,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  prefs: DashboardPrefs
  onChange: (widgets: DashboardPrefs['widgets']) => void
  onReset: () => void
}) {
  const { t } = useI18n()
  const list = prefs.widgets
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= list.length) return
    const next = [...list]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  const toggle = (i: number) => onChange(list.map((w, k) => (k === i ? { ...w, visible: !w.visible } : w)))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('custom.title')}</DialogTitle>
          <DialogDescription>{t('custom.desc')}</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-1.5">
          {list.map((w, i) => {
            const locked = w.id === 'monitors'
            const label = t(labelKey[w.id])
            return (
              <li key={w.id} className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-2', !w.visible && 'bg-muted/30')}>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={locked}
                  aria-pressed={w.visible}
                  aria-label={t(w.visible ? 'custom.hide' : 'custom.show', { name: label })}
                  title={locked ? t('custom.alwaysShown') : t(w.visible ? 'custom.hide' : 'custom.show', { name: label })}
                  onClick={() => toggle(i)}
                >
                  {locked ? <Lock /> : w.visible ? <Eye /> : <EyeOff className="text-muted-foreground" />}
                </Button>
                <span className={cn('min-w-0 flex-1 truncate text-sm', w.visible ? 'font-medium' : 'text-muted-foreground')}>{label}</span>
                <Button type="button" size="icon-sm" variant="ghost" disabled={i === 0} aria-label={t('custom.moveUp', { name: label })} title={t('custom.moveUp', { name: label })} onClick={() => move(i, -1)}>
                  <ArrowUp />
                </Button>
                <Button type="button" size="icon-sm" variant="ghost" disabled={i === list.length - 1} aria-label={t('custom.moveDown', { name: label })} title={t('custom.moveDown', { name: label })} onClick={() => move(i, 1)}>
                  <ArrowDown />
                </Button>
              </li>
            )
          })}
        </ul>
        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="ghost" onClick={onReset}>
            <RotateCcw />
            {t('custom.reset')}
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            {t('common.done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
