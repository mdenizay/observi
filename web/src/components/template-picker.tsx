import { LayoutTemplate } from 'lucide-react'
import { useI18n } from '@/i18n'
import { TEMPLATES, type MonitorTemplate } from '@/lib/templates'
import { cn } from '@/lib/utils'

export function TemplatePicker({ activeId, onPick }: { activeId: string | null; onPick: (tpl: MonitorTemplate | null) => void }) {
  const { t } = useI18n()
  const active = TEMPLATES.find((x) => x.id === activeId)
  return (
    <section className="bg-card shadow-card mb-4 rounded-xl border p-4">
      <div className="mb-3 flex items-center gap-2">
        <LayoutTemplate className="text-muted-foreground size-4" />
        <h2 className="text-sm font-semibold">{t('tpl.title')}</h2>
      </div>
      <div role="radiogroup" aria-label={t('tpl.title')} className="flex flex-wrap gap-1.5">
        <button
          type="button"
          role="radio"
          aria-checked={activeId === null}
          onClick={() => onPick(null)}
          className={cn(
            'hover:bg-accent focus-visible:ring-ring/50 h-8 rounded-full border px-3 text-sm outline-none focus-visible:ring-[3px]',
            activeId === null && 'border-foreground/60 bg-accent font-medium',
          )}
        >
          {t('tpl.blank')}
        </button>
        {TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            role="radio"
            aria-checked={activeId === tpl.id}
            title={t(tpl.desc)}
            onClick={() => onPick(tpl)}
            className={cn(
              'hover:bg-accent focus-visible:ring-ring/50 h-8 rounded-full border px-3 text-sm outline-none focus-visible:ring-[3px]',
              activeId === tpl.id && 'border-foreground/60 bg-accent font-medium',
            )}
          >
            {t(tpl.name)}
          </button>
        ))}
      </div>
      {active && <p className="text-muted-foreground mt-2.5 text-xs">{t(active.desc)}</p>}
    </section>
  )
}
