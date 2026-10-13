import { Suspense, useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import {
  Bell,
  Folder,
  House,
  Loader2,
  Menu,
  Plus,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { Logo } from '@/components/logo'
import { UserMenu } from '@/components/user-menu'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { useUser } from '@/hooks/use-auth'
import { useLiveUpdates } from '@/hooks/use-live-updates'
import { cn } from '@/lib/utils'
import { useI18n, type Key } from '@/i18n'

interface NavItem {
  to: string
  labelKey: Key
  icon: LucideIcon
  admin?: boolean
  end?: boolean
}

const nav: NavItem[] = [
  { to: '/dashboard', labelKey: 'nav.dashboard', icon: House },
  { to: '/monitors/new', labelKey: 'nav.newMonitor', icon: Plus, admin: true, end: true },
  { to: '/groups', labelKey: 'nav.groups', icon: Folder, admin: true },
  { to: '/users', labelKey: 'nav.users', icon: Users, admin: true },
  { to: '/notifications', labelKey: 'nav.notifications', icon: Bell, admin: true },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings },
]

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n()
  const user = useUser()
  const isAdmin = user.role === 'superadmin'

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        <Logo onNavigate={onNavigate} />
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2">
        {nav
          .filter((n) => !n.admin || isAdmin)
          .map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'text-muted-foreground hover:bg-accent hover:text-accent-foreground flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors',
                  isActive && 'bg-accent text-accent-foreground',
                )
              }
            >
              <n.icon className="size-4" />
              {t(n.labelKey)}
            </NavLink>
          ))}
      </nav>
      <div className="border-t p-2">
        <UserMenu onNavigate={onNavigate} />
      </div>
    </div>
  )
}

export function AppShell() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  useLiveUpdates(true)

  return (
    <div className="min-h-dvh lg:pl-60">
      <aside className="bg-sidebar fixed inset-y-0 left-0 z-30 hidden w-60 border-r lg:block">
        <SidebarContent />
      </aside>

      <header className="bg-background/80 sticky top-0 z-20 flex h-14 items-center gap-2 border-b px-3 backdrop-blur lg:hidden">
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)} aria-label={t('nav.openMenu')}>
          <Menu />
        </Button>
        <Logo />
        <div className="flex-1" />
        <UserMenu compact />
      </header>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="p-0">
          <SheetTitle className="sr-only">{t('nav.menu')}</SheetTitle>
          <SheetDescription className="sr-only">{t('nav.menuDesc')}</SheetDescription>
          <SidebarContent onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <main className="mx-auto w-full max-w-[1600px] p-3 sm:p-4 lg:p-6">
        <Suspense
          fallback={
            <div className="flex justify-center py-24">
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 lg:mb-6">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
