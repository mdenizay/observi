import { Link } from 'react-router'
import { ArrowUpCircle, Loader2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useApplyUpdate, useFollowServerUpdate, useUpdateInfo } from '@/hooks/use-update'
import { useI18n } from '@/i18n'

/** Compact sidebar card shown to superadmins when a newer release is available. */
export function UpdateNotice({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n()
  const { data: info } = useUpdateInfo()
  const { phase, target, apply, checkAgain } = useApplyUpdate()
  useFollowServerUpdate(info)

  if (!info) return null
  const latest = target ?? info.latest
  const updating = phase === 'applying' || info.state === 'updating'

  if (phase === 'timeout')
    return (
      <div className="border-pending/30 bg-pending/[0.07] mx-2 mb-2 rounded-xl border p-3 text-xs">
        <div className="text-pending flex items-start gap-2">
          <TriangleAlert className="mt-px size-4 shrink-0" />
          <span>{t('upd.timeout')}</span>
        </div>
        <Button size="xs" variant="outline" className="mt-2.5 w-full" onClick={checkAgain}>
          {t('upd.checkAgain')}
        </Button>
      </div>
    )

  if (updating)
    return (
      <div className="bg-card shadow-card mx-2 mb-2 flex items-center gap-2.5 rounded-xl border p-3 text-xs" role="status">
        <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
        <span className="font-medium">{t('upd.updating', { v: latest ?? '' })}</span>
      </div>
    )

  if (!info.available || !info.latest) return null

  return (
    <div className="bg-card shadow-card mx-2 mb-2 rounded-xl border p-3">
      <div className="flex items-center gap-2.5">
        <ArrowUpCircle className="text-up size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{t('upd.available')}</div>
          <div className="text-muted-foreground num text-xs">v{info.latest}</div>
        </div>
      </div>
      <div className="mt-2.5 flex gap-1.5">
        {info.can_apply && (
          <Button size="xs" className="flex-1" onClick={apply}>
            {t('upd.now')}
          </Button>
        )}
        <Button asChild size="xs" variant="outline" className="flex-1">
          <Link to="/settings#updates" onClick={onNavigate}>
            {t('upd.details')}
          </Link>
        </Button>
      </div>
    </div>
  )
}
