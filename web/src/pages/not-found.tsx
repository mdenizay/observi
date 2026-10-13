import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'

export function NotFoundPage() {
  const { t } = useI18n()
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <div className="text-5xl font-semibold tracking-tight">404</div>
      <p className="text-muted-foreground text-sm">{t('nf.message')}</p>
      <Button asChild variant="outline" size="sm">
        <Link to="/dashboard">{t('nf.back')}</Link>
      </Button>
    </div>
  )
}
