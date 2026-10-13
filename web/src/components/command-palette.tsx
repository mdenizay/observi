import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  Bell,
  CornerDownLeft,
  Folder,
  House,
  Languages,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { statusDot } from '@/components/status-badge'
import { Kbd } from '@/components/ui/kbd'
import { useIsAdmin } from '@/hooks/use-auth'
import { useMonitors } from '@/hooks/use-monitors'
import { useTheme } from '@/hooks/use-theme'
import { LANGS, useI18n } from '@/i18n'
import { monitorTarget } from '@/lib/format'
import { fuzzyScore } from '@/lib/fuzzy'
import { cn } from '@/lib/utils'

interface Item {
  id: string
  section: 'monitors' | 'nav' | 'actions'
  label: string
  hint?: string
  icon?: LucideIcon
  dot?: string
  run: () => void
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t, lang, setLang } = useI18n()
  const { resolved, setMode } = useTheme()
  const isAdmin = useIsAdmin()
  const navigate = useNavigate()
  const { data: monitors } = useMonitors()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const close = () => onOpenChange(false)
  const go = (to: string) => () => {
    close()
    navigate(to)
  }

  const items = useMemo<Item[]>(() => {
    const other = LANGS.find((l) => l.code !== lang)!
    const nav: Item[] = [
      { id: 'nav-dash', section: 'nav', label: t('nav.dashboard'), icon: House, run: go('/dashboard') },
      ...(isAdmin
        ? [
            { id: 'nav-new', section: 'nav', label: t('nav.newMonitor'), icon: Plus, run: go('/monitors/new') },
            { id: 'nav-groups', section: 'nav', label: t('nav.groups'), icon: Folder, run: go('/groups') },
            { id: 'nav-users', section: 'nav', label: t('nav.users'), icon: Users, run: go('/users') },
            { id: 'nav-notif', section: 'nav', label: t('nav.notifications'), icon: Bell, run: go('/notifications') },
          ]
        : []),
      { id: 'nav-settings', section: 'nav', label: t('nav.settings'), icon: Settings, run: go('/settings') },
    ] as Item[]
    const actions: Item[] = [
      {
        id: 'act-theme',
        section: 'actions',
        label: t('cmd.toggleTheme', { theme: resolved === 'dark' ? t('theme.light') : t('theme.dark') }),
        icon: resolved === 'dark' ? Sun : Moon,
        run: () => setMode(resolved === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'act-lang',
        section: 'actions',
        label: t('cmd.switchLang', { lang: other.label }),
        icon: Languages,
        run: () => setLang(other.code),
      },
    ]
    const mons: Item[] = (monitors ?? []).map((m) => ({
      id: `m-${m.id}`,
      section: 'monitors',
      label: m.name,
      hint: monitorTarget(m),
      dot: statusDot[m.active ? m.status : 'paused'],
      run: go(`/dashboard/${m.id}`),
    }))

    const query = q.trim()
    const rank = (list: Item[], limit: number) => {
      if (!query) return list.slice(0, limit)
      return list
        .map((it) => ({ it, s: Math.max(fuzzyScore(query, it.label, lang), fuzzyScore(query, it.hint ?? '', lang) - 50) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, limit)
        .map((x) => x.it)
    }
    return [...rank(mons, query ? 8 : 5), ...rank(nav, 8), ...rank(actions, 4)]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, monitors, isAdmin, lang, resolved, t])

  useEffect(() => setActive(0), [q, open])
  useEffect(() => {
    if (!open) setQ('')
  }, [open])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(items.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      items[active]?.run()
    }
  }

  const sectionTitle = { monitors: t('cmd.monitors'), nav: t('cmd.navigation'), actions: t('cmd.actions') }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          onKeyDown={onKeyDown}
          className="bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] fixed top-[12vh] left-1/2 z-50 flex max-h-[min(32rem,76vh)] w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-2xl border shadow-pop duration-150"
        >
          <DialogPrimitive.Title className="sr-only">{t('cmd.title')}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">{t('cmd.placeholder')}</DialogPrimitive.Description>
          <div className="flex items-center gap-2.5 border-b px-4">
            <Search className="text-muted-foreground size-4 shrink-0" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('cmd.placeholder')}
              role="combobox"
              aria-expanded
              aria-controls="cmd-list"
              aria-activedescendant={items[active] ? `cmd-${items[active].id}` : undefined}
              className="placeholder:text-muted-foreground h-12 w-full bg-transparent text-sm outline-none"
            />
            <Kbd>esc</Kbd>
          </div>
          <div ref={listRef} id="cmd-list" role="listbox" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1.5">
            {items.length === 0 && <div className="text-muted-foreground py-10 text-center text-sm">{t('cmd.empty')}</div>}
            {items.map((it, i) => {
              const showHeader = i === 0 || items[i - 1].section !== it.section
              return (
                <div key={it.id}>
                  {showHeader && (
                    <div className="text-muted-foreground px-2.5 pt-2.5 pb-1 text-xs font-medium">
                      {sectionTitle[it.section]}
                    </div>
                  )}
                  <div
                    id={`cmd-${it.id}`}
                    role="option"
                    aria-selected={i === active}
                    data-index={i}
                    onMouseMove={() => setActive(i)}
                    onClick={() => it.run()}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm',
                      i === active && 'bg-accent text-accent-foreground',
                    )}
                  >
                    {it.dot ? (
                      <span className="flex size-4 items-center justify-center">
                        <span className={cn('size-2 rounded-full', it.dot)} />
                      </span>
                    ) : it.icon ? (
                      <it.icon className="text-muted-foreground size-4" />
                    ) : null}
                    <span className="min-w-0 truncate">{it.label}</span>
                    {it.hint && <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{it.hint}</span>}
                    {i === active && <CornerDownLeft className="text-muted-foreground ml-auto size-3.5 shrink-0" />}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="text-muted-foreground bg-muted/40 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t px-4 py-2.5 text-xs">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              {t('cmd.kbNavigate')}
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>↵</Kbd>
              {t('cmd.kbOpen')}
            </span>
            <span className="hidden items-center gap-1.5 sm:flex">
              <Kbd>/</Kbd>
              {t('cmd.kbSearch')}
            </span>
            {isAdmin && (
              <span className="hidden items-center gap-1.5 sm:flex">
                <Kbd>n</Kbd>
                {t('cmd.kbNew')}
              </span>
            )}
            <span className="hidden items-center gap-1.5 sm:flex">
              <Kbd>g</Kbd>
              <Kbd>d</Kbd>
              {t('cmd.kbDashboard')}
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
