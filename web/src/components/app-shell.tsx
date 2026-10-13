import { Fragment, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { matchPath, NavLink, Outlet, useLocation } from 'react-router'
import { Bell, ChevronRight, Folder, House, Loader2, Menu, Plus, Search, Settings, Users, type LucideIcon } from 'lucide-react'
import { CommandPalette } from '@/components/command-palette'
import { Logo } from '@/components/logo'
import { UpdateNotice } from '@/components/update-notice'
import { UserMenu } from '@/components/user-menu'
import { Button } from '@/components/ui/button'
import { isMac, Kbd } from '@/components/ui/kbd'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { useIsAdmin } from '@/hooks/use-auth'
import { useLiveStatus, useLiveUpdates } from '@/hooks/use-live-updates'
import { useGlobalShortcuts } from '@/hooks/use-shortcuts'
import { checkServerVersion } from '@/hooks/use-update'
import { useI18n, type Key } from '@/i18n'
import { cn } from '@/lib/utils'

interface NavItem {
  to: string
  labelKey: Key
  icon: LucideIcon
  end?: boolean
}

const monitoring: NavItem[] = [
  { to: '/dashboard', labelKey: 'nav.dashboard', icon: House },
  { to: '/monitors/new', labelKey: 'nav.newMonitor', icon: Plus, end: true },
]
const admin: NavItem[] = [
  { to: '/groups', labelKey: 'nav.groups', icon: Folder },
  { to: '/users', labelKey: 'nav.users', icon: Users },
  { to: '/notifications', labelKey: 'nav.notifications', icon: Bell },
]

function NavItemLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const { t } = useI18n()
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'text-muted-foreground hover:text-foreground hover:bg-sidebar-active/60 focus-visible:ring-ring/50 flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors duration-150 outline-none focus-visible:ring-[3px]',
          isActive && 'bg-sidebar-active text-foreground hover:bg-sidebar-active',
        )
      }
    >
      {({ isActive }) => (
        <>
          <item.icon className={cn('size-4', isActive ? 'text-foreground' : 'text-muted-foreground')} />
          {t(item.labelKey)}
        </>
      )}
    </NavLink>
  )
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n()
  const isAdmin = useIsAdmin()
  const section = (label: string, items: NavItem[]) => (
    <div className="flex flex-col gap-0.5">
      <div className="text-muted-foreground/80 px-2.5 pt-4 pb-1.5 text-xs font-medium">{label}</div>
      {items.map((it) => (
        <NavItemLink key={it.to} item={it} onNavigate={onNavigate} />
      ))}
    </div>
  )
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center px-4">
        <Logo onNavigate={onNavigate} />
      </div>
      <nav className="scrollbar-thin flex flex-1 flex-col overflow-y-auto px-2.5 pb-2">
        {section(t('nav.section.monitoring'), isAdmin ? monitoring : monitoring.slice(0, 1))}
        {isAdmin && section(t('nav.section.admin'), admin)}
        <div className="mt-auto pt-4">
          <NavItemLink item={{ to: '/settings', labelKey: 'nav.settings', icon: Settings }} onNavigate={onNavigate} />
        </div>
      </nav>
      {isAdmin && <UpdateNotice onNavigate={onNavigate} />}
      <div className="border-t p-2">
        <UserMenu onNavigate={onNavigate} />
      </div>
    </div>
  )
}

function useBreadcrumb(): string[] {
  const { t } = useI18n()
  const { pathname } = useLocation()
  if (matchPath('/dashboard/*', pathname)) return [t('nav.section.monitoring'), t('nav.dashboard')]
  if (matchPath('/monitors/new', pathname)) return [t('nav.section.monitoring'), t('nav.newMonitor')]
  if (matchPath('/monitors/:id/edit', pathname)) return [t('nav.section.monitoring'), t('mf.titleEdit')]
  if (matchPath('/groups', pathname)) return [t('nav.section.admin'), t('nav.groups')]
  if (matchPath('/users', pathname)) return [t('nav.section.admin'), t('nav.users')]
  if (matchPath('/notifications', pathname)) return [t('nav.section.admin'), t('nav.notifications')]
  if (matchPath('/settings', pathname)) return [t('nav.settings')]
  return []
}

/** Shows nothing while live updates are healthy; a small amber notice while reconnecting. */
function LiveIndicator({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n()
  const status = useLiveStatus()
  if (status !== 'reconnecting') return null
  return (
    <div
      role="status"
      title={t('live.offHint')}
      className={cn(
        'text-pending border-pending/30 bg-pending/8 flex h-7 items-center gap-2 rounded-full border px-2.5 text-xs font-medium',
        compact && 'px-2',
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      <span className={cn(compact && 'sr-only')}>{t('live.reconnecting')}</span>
    </div>
  )
}

/** Checks the server version on start and after every reconnect. */
function useServerVersionWatch() {
  const status = useLiveStatus()
  const prev = useRef(status)
  useEffect(() => {
    void checkServerVersion()
  }, [])
  useEffect(() => {
    if (prev.current === 'reconnecting' && status === 'live') void checkServerVersion()
    prev.current = status
  }, [status])
}

export function AppShell() {
  const { t } = useI18n()
  const isAdmin = useIsAdmin()
  const [open, setOpen] = useState(false)
  const [palette, setPalette] = useState(false)
  const crumbs = useBreadcrumb()
  const togglePalette = useCallback(() => setPalette((p) => !p), [])
  useLiveUpdates(true)
  useServerVersionWatch()
  useGlobalShortcuts({ togglePalette, isAdmin })

  return (
    <div className="min-h-dvh lg:pl-60">
      <aside className="bg-sidebar fixed inset-y-0 left-0 z-30 hidden w-60 border-r lg:block">
        <SidebarContent />
      </aside>

      <header className="bg-background/85 sticky top-0 z-20 flex h-14 items-center gap-2 border-b px-3 backdrop-blur-md sm:px-4 lg:px-6">
        <Button
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          onClick={() => setOpen(true)}
          aria-label={t('nav.openMenu')}
        >
          <Menu />
        </Button>
        <div className="min-w-0 lg:hidden">
          <Logo />
        </div>
        <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-sm lg:flex">
          {crumbs.map((c, i) => (
            <Fragment key={i}>
              {i > 0 && <ChevronRight className="text-muted-foreground/60 size-3.5 shrink-0" />}
              <span
                className={cn('truncate', i === crumbs.length - 1 ? 'text-foreground font-medium' : 'text-muted-foreground')}
                aria-current={i === crumbs.length - 1 ? 'page' : undefined}
              >
                {c}
              </span>
            </Fragment>
          ))}
        </nav>
        <div className="flex-1" />
        <div className="hidden sm:block">
          <LiveIndicator />
        </div>
        <div className="sm:hidden">
          <LiveIndicator compact />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPalette(true)}
          className="text-muted-foreground hidden h-8 gap-2 pr-1.5 pl-2.5 font-normal sm:inline-flex"
        >
          <Search className="size-3.5" />
          <span className="pr-3">{t('search.button')}</span>
          <Kbd>{isMac ? '⌘' : 'Ctrl'} K</Kbd>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="sm:hidden"
          onClick={() => setPalette(true)}
          aria-label={t('search.button')}
        >
          <Search />
        </Button>
        <div className="lg:hidden">
          <UserMenu compact />
        </div>
      </header>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="bg-sidebar p-0">
          <SheetTitle className="sr-only">{t('nav.menu')}</SheetTitle>
          <SheetDescription className="sr-only">{t('nav.menuDesc')}</SheetDescription>
          <SidebarContent onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <CommandPalette open={palette} onOpenChange={setPalette} />

      <main className="mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-4 sm:py-5 lg:px-6 lg:py-6">
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
  count,
  actions,
}: {
  title: string
  description?: React.ReactNode
  count?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 lg:mb-6">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
          {count !== undefined && <span className="text-muted-foreground num text-sm">{count}</span>}
        </div>
        {description && <p className="text-muted-foreground mt-1 max-w-prose text-sm">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
