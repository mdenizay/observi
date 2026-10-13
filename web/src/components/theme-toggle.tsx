import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/hooks/use-theme'
import { useI18n } from '@/i18n'

export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useI18n()
  const { theme, toggle } = useTheme()
  const label = theme === 'dark' ? t('theme.toLight') : t('theme.toDark')
  return (
    <Button variant="ghost" size="icon-sm" onClick={toggle} title={label} aria-label={label} className={className}>
      {theme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  )
}
