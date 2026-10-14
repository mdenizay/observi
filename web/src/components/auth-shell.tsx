import { LanguageSwitcher } from '@/components/language-switcher'
import { BrandMark } from '@/components/logo'
import { ThemeToggle } from '@/components/theme-toggle'
import { Card, CardContent } from '@/components/ui/card'
import { useBrand } from '@/hooks/use-brand'
import { useI18n } from '@/i18n'

/** Centered brand + card layout shared by the sign-in and password-reset pages. */
export function AuthShell({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  const { t } = useI18n()
  const { name } = useBrand()
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden p-4">
      <div
        aria-hidden
        className="graticule pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_60%_55%_at_50%_42%,black,transparent_80%)]"
      />
      <div
        aria-hidden
        className="bg-primary/20 pointer-events-none absolute top-[18%] left-1/2 size-[34rem] -translate-x-1/2 rounded-full opacity-60 blur-[120px] dark:opacity-40"
      />
      <div className="absolute top-4 right-4 z-10 flex items-center gap-1">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark className="shadow-raised size-11 rounded-xl" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
            <p className="text-muted-foreground text-sm">{subtitle ?? t('login.subtitle')}</p>
          </div>
        </div>
        <Card className="shadow-pop rounded-2xl py-6">
          <CardContent className="px-6">{children}</CardContent>
        </Card>
      </div>
    </div>
  )
}
