import { Suspense, useCallback, useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import {
  Bell,
  BookOpen,
  ExternalLink,
  Folder,
  House,
  Loader2,
  Menu,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { CommandPalette } from '@/components/command-palette'
import { BrandMark, Logo } from '@/components/logo'
import { UserMenu } from '@/components/user-menu'
import { Button } from '@/components/ui/button'
import { isMac, Kbd } from '@/components/ui/kbd'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { useIsAdmin } from '@/hooks/use-auth'
import { useBrand } from '@/hooks/use-brand'
import { useLiveStatus, useLiveUpdates } from '@/hooks/use-live-updates'
import { useGlobalShortcuts } from '@/hooks/use-shortcuts'
import { useI18n, type Key } from '@/i18n'
import { cn } from '@/lib/utils'

const DOCS_URL = 'https://github.com/mdenizay/observi'
const COLLAPSE_KEY = 'observi-sidebar-collapsed'

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

/** Tooltip shown to the right of an icon in the collapsed rail. */
function RailTip({ label, show, children }: { label: string; show: boolean; children: React.ReactNode }) {
  if (!show) return <>{children}</>
  return (
    <div className="group/rail relative">
      {children}
      <span
        role="tooltip"
        className="bg-popover text-popover-foreground shadow-pop pointer-events-none invisible absolute top-1/2 left-full z-50 ml-3 -translate-y-1/2 rounded-lg border px-2.5 py-1 text-xs whitespace-nowrap opacity-0 transition-opacity duration-150 group-focus-within/rail:visible group-focus-within/rail:opacity-100 group-hover/rail:visible group-hover/rail:opacity-100"
      >
        {label}
      </span>
    </div>
  )
}

const itemCls = (active: boolean, collapsed: boolean) =>
  cn(
    'text-muted-foreground hover:text-foreground hover:bg-sidebar-active/60 focus-visible:ring-ring/40 flex h-9 items-center gap-3 rounded-xl text-sm transition-colors duration-150 outline-none focus-visible:ring-[3px]',
    collapsed ? 'w-9 justify-center' : 'px-3',
    active && 'bg-sidebar-active text-foreground hover:bg-sidebar-active',
  )

function NavItemLink({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const { t } = useI18n()
  const label = t(item.labelKey)
  return (
    <RailTip label={label} show={collapsed}>
      <NavLink
        to={item.to}
        end={item.end}
        onClick={onNavigate}
        aria-label={collapsed ? label : undefined}
        className={({ isActive }) => itemCls(isActive, collapsed)}
      >
        <item.icon className="size-[18px] shrink-0" />
        {!collapsed && <span className="truncate">{label}</span>}
      </NavLink>
    </RailTip>
  )
}

function LiveIndicator({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n()
  const status = useLiveStatus()
  const live = status === 'live'
  const label = live ? t('live.live') : status === 'reconnecting' ? t('live.reconnecting') : t('live.connecting')
  return (
    <span
      role="status"
      title={live ? t('live.liveHint') : t('live.offHint')}
      className={cn('inline-flex items-center gap-1.5 text-xs', live ? 'text-muted-foreground' : 'text-pending')}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', live ? 'bg-up live-dot text-up' : 'bg-pending')} />
      <span className={cn(compact && 'sr-only')}>{label}</span>
    </span>
  )
}

function SidebarContent({
  collapsed = false,
  onToggle,
  onNavigate,
  onSearch,
}: {
  collapsed?: boolean
  onToggle?: () => void
  onNavigate?: () => void
  onSearch: () => void
}) {
  const { t } = useI18n()
  const { name } = useBrand()
  const isAdmin = useIsAdmin()

  const section = (label: string, items: NavItem[]) => (
    <div className="flex flex-col gap-0.5">
      {collapsed ? (
        <div className="bg-border mx-auto my-3 h-px w-6" />
      ) : (
        <div className="text-muted-foreground px-3 pt-5 pb-1.5 text-xs">{label}</div>
      )}
      {items.map((it) => (
        <NavItemLink key={it.to} item={it} collapsed={collapsed} onNavigate={onNavigate} />
      ))}
    </div>
  )

  const toggleLabel = collapsed ? t('sidebar.expand') : t('sidebar.collapse')

  return (
    <div className={cn('flex h-full flex-col', collapsed ? 'items-center px-2' : 'px-3')}>
      <div className={cn('flex h-16 w-full shrink-0 items-center gap-2', collapsed ? 'justify-center' : 'justify-between pl-1')}>
        {collapsed ? (
          <RailTip label={toggleLabel} show>
            <button
              type="button"
              onClick={onToggle}
              aria-label={toggleLabel}
              className="focus-visible:ring-ring/40 rounded-lg outline-none focus-visible:ring-[3px]"
            >
              <BrandMark />
              <span className="sr-only">{name}</span>
            </button>
          </RailTip>
        ) : (
          <>
            <Logo onNavigate={onNavigate} />
            {onToggle && (
              <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label={toggleLabel} title={toggleLabel}>
                <PanelLeft />
              </Button>
            )}
          </>
        )}
      </div>

      <RailTip label={t('search.button')} show={collapsed}>
        <button
          type="button"
          onClick={onSearch}
          aria-label={collapsed ? t('search.button') : undefined}
          className={cn(
            'text-muted-foreground hover:text-foreground focus-visible:ring-ring/40 flex h-9 items-center gap-2.5 rounded-xl text-sm transition-colors outline-none focus-visible:ring-[3px]',
            collapsed ? 'hover:bg-sidebar-active/60 w-9 justify-center' : 'bg-sidebar-active/60 hover:bg-sidebar-active w-full px-3',
          )}
        >
          <Search className="size-4 shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">{t('list.search')}</span>
              <Kbd className="bg-transparent">{isMac ? '⌘' : 'Ctrl'} K</Kbd>
            </>
          )}
        </button>
      </RailTip>

      <nav className={cn('scrollbar-thin flex w-full flex-1 flex-col pb-2', collapsed ? 'items-center overflow-visible' : 'overflow-y-auto')}>
        {section(t('nav.section.monitoring'), isAdmin ? monitoring : monitoring.slice(0, 1))}
        {isAdmin && section(t('nav.section.admin'), admin)}
        <div className={cn('mt-auto flex flex-col gap-0.5 pt-4', collapsed && 'items-center')}>
          <NavItemLink
            item={{ to: '/settings', labelKey: 'nav.settings', icon: Settings }}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
          <RailTip label={t('nav.docs')} show={collapsed}>
            <a href={DOCS_URL} target="_blank" rel="noreferrer noopener" className={itemCls(false, collapsed)} aria-label={collapsed ? t('nav.docs') : undefined}>
              <BookOpen className="size-[18px] shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 truncate">{t('nav.docs')}</span>
                  <ExternalLink className="size-3.5 opacity-60" />
                </>
              )}
            </a>
          </RailTip>
        </div>
      </nav>

      <div className={cn('w-full shrink-0 pb-3', collapsed && 'flex flex-col items-center')}>
        <div className={cn('flex items-center justify-between px-3 pt-1 pb-2', collapsed && 'justify-center px-0')}>
          <LiveIndicator compact={collapsed} />
          {!collapsed && <span className="text-muted-foreground/70 num text-xs">v{__APP_VERSION__}</span>}
        </div>
        {collapsed ? (
          <UserMenu compact side="right" align="end" onNavigate={onNavigate} />
        ) : (
          <UserMenu onNavigate={onNavigate} />
        )}
      </div>
    </div>
  )
}

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

export function AppShell() {
  const { t } = useI18n()
  const isAdmin = useIsAdmin()
  const [open, setOpen] = useState(false)
  const [palette, setPalette] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const togglePalette = useCallback(() => setPalette((p) => !p), [])
  const openPalette = useCallback(() => {
    setOpen(false)
    setPalette(true)
  }, [])
  useLiveUpdates(true)
  useGlobalShortcuts({ togglePalette, isAdmin })

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1')
      } catch {
        /* storage unavailable */
      }
      return !c
    })

  return (
    <div className={cn('min-h-dvh transition-[padding] duration-200', collapsed ? 'lg:pl-[4.25rem]' : 'lg:pl-64')}>
      <aside
        className={cn(
          'bg-sidebar fixed inset-y-0 left-0 z-30 hidden transition-[width] duration-200 lg:block',
          collapsed ? 'w-[4.25rem]' : 'w-64',
        )}
      >
        <SidebarContent collapsed={collapsed} onToggle={toggleCollapsed} onSearch={openPalette} />
      </aside>

      {/* Mobile top bar */}
      <header className="bg-background/85 sticky top-0 z-20 flex h-14 items-center gap-1.5 px-3 backdrop-blur-md lg:hidden">
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)} aria-label={t('nav.openMenu')}>
          <Menu />
        </Button>
        <div className="min-w-0">
          <Logo />
        </div>
        <div className="flex-1" />
        <LiveIndicator compact />
        <Button variant="ghost" size="icon-sm" onClick={() => setPalette(true)} aria-label={t('search.button')}>
          <Search />
        </Button>
        <UserMenu compact />
      </header>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="bg-sidebar w-72 border-r-0 p-0">
          <SheetTitle className="sr-only">{t('nav.menu')}</SheetTitle>
          <SheetDescription className="sr-only">{t('nav.menuDesc')}</SheetDescription>
          <SidebarContent onNavigate={() => setOpen(false)} onSearch={openPalette} />
        </SheetContent>
      </Sheet>

      <CommandPalette open={palette} onOpenChange={setPalette} />

      <main className="mx-auto w-full max-w-[1600px] px-3 pt-2 pb-6 sm:px-5 lg:px-8 lg:pt-7 lg:pb-8">
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
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 lg:mb-7">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {count !== undefined && <span className="text-muted-foreground num text-base">{count}</span>}
        </div>
        {description && <p className="text-muted-foreground mt-1 max-w-prose text-sm">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
