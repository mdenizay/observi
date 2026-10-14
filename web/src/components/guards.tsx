import { Navigate, Outlet, useLocation } from 'react-router'
import { Loader2 } from 'lucide-react'
import { useMe, useSetupStatus } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'

export function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Loader2 className="text-muted-foreground size-6 animate-spin" />
    </div>
  )
}

export function RequireAuth() {
  const { t } = useI18n()
  const { data, isPending, isError, refetch } = useMe()
  const location = useLocation()
  const setup = useSetupStatus(data === null)
  if (isPending || (data === null && setup.isPending)) return <FullPageSpinner />
  if (isError)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="text-muted-foreground text-sm">{t('guards.unreachable')}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  if (!data && setup.data) return <Navigate to="/setup" replace />
  if (!data) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <Outlet />
}

export function RequireSuperadmin() {
  const { data } = useMe()
  if (data?.role !== 'superadmin') return <Navigate to="/dashboard" replace />
  return <Outlet />
}
