import { Suspense, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  Bell,
  Folder,
  House,
  Loader2,
  LogOut,
  Menu,
  Plus,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { LanguageSwitcher } from '@/components/language-switcher'
import { Logo } from '@/components/logo'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { useUser } from '@/hooks/use-auth'
import { useLiveUpdates } from '@/hooks/use-live-updates'
import { api } from '@/lib/api'
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
  const qc = useQueryClient()
  const navigate = useNavigate()
  const isAdmin = user.role === 'superadmin'

  const logout = async () => {
    try {
      await api.logout()
    } catch {
      /* session might already be gone */
    }
    qc.clear()
    qc.setQueryData(['me'], null)
    toast.success(t('nav.signedOut'))
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        <Logo />
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
      <div className="border-t p-3">
        <div className="flex items-center gap-2.5">
          <div className="bg-accent text-accent-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase">
            {initials(user.name || user.username)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{user.name || user.username}</div>
            <div className="text-muted-foreground truncate text-xs">
              {isAdmin ? t('role.superadmin') : t('role.user')}
            </div>
          </div>
          <LanguageSwitcher side="up" />
          <ThemeToggle />
        </div>
        <Button variant="ghost" size="sm" className="text-muted-foreground mt-2 w-full justify-start" onClick={logout}>
          <LogOut />
          {t('nav.signOut')}
        </Button>
      </div>
    </div>
  )
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
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
        <LanguageSwitcher />
        <ThemeToggle />
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
