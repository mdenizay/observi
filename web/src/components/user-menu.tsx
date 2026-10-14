import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowUpCircle, BookOpen, ChevronsUpDown, ExternalLink, LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuSegment,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useUser } from '@/hooks/use-auth'
import { useTheme, type ThemeMode } from '@/hooks/use-theme'
import { BUILD_VERSION, useUpdateInfo } from '@/hooks/use-update'
import { LANGS, useI18n, type Lang } from '@/i18n'
import { api } from '@/lib/api'

/**
 * Bottom-of-sidebar account menu: user info, language, theme, settings and sign out.
 * `compact` renders only the avatar (mobile top bar) and opens downward.
 */
export function UserMenu({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const { t, lang, setLang } = useI18n()
  const { mode, setMode } = useTheme()
  const user = useUser()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const isAdmin = user.role === 'superadmin'
  const display = user.name || user.username
  const role = isAdmin ? t('role.superadmin') : t('role.user')
  const { data: update } = useUpdateInfo()
  const hasUpdate = isAdmin && !!update?.available && !!update.latest
  const dot = hasUpdate && (
    <span className="bg-up ring-sidebar absolute -top-0.5 -right-0.5 size-2.5 rounded-full ring-2" aria-hidden />
  )

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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <button
            type="button"
            aria-label={t('usermenu.open')}
            className="focus-visible:ring-ring/50 relative rounded-full outline-none focus-visible:ring-[3px]"
          >
            <Avatar name={display} />
            {dot}
          </button>
        ) : (
          <button
            type="button"
            aria-label={t('usermenu.open')}
            className="hover:bg-accent data-[state=open]:bg-accent focus-visible:ring-ring/50 flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors outline-none focus-visible:ring-[3px]"
          >
            <span className="relative">
              <Avatar name={display} />
              {dot}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm leading-tight font-medium">{display}</div>
              <div className="text-muted-foreground truncate text-xs leading-tight">{role}</div>
            </div>
            <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={compact ? 'bottom' : 'top'}
        align={compact ? 'end' : 'start'}
        className="w-64 max-w-[calc(100vw-1.5rem)] min-w-60"
      >
        <div className="text-muted-foreground flex items-center justify-between gap-3 px-2 pt-1 pb-1.5 text-xs">
          <span className="min-w-0 truncate">@{user.username}</span>
          <span className="num shrink-0">v{BUILD_VERSION}</span>
        </div>
        <DropdownMenuSeparator />

        {hasUpdate && (
          <DropdownMenuItem
            className="text-up focus:text-up h-9"
            onSelect={() => {
              onNavigate?.()
              navigate('/settings#updates')
            }}
          >
            <ArrowUpCircle />
            <span className="truncate">{t('upd.menuEntry', { v: update!.latest! })}</span>
          </DropdownMenuItem>
        )}

        <div className="flex h-9 items-center justify-between gap-3 px-2">
          <span className="text-muted-foreground text-xs font-medium">{t('lang.label')}</span>
          <DropdownMenuRadioGroup
            value={lang}
            onValueChange={(v) => setLang(v as Lang)}
            className="bg-muted flex w-36 gap-0.5 rounded-md p-0.5"
          >
            {LANGS.map((l) => (
              <DropdownMenuSegment key={l.code} value={l.code}>
                {l.label}
              </DropdownMenuSegment>
            ))}
          </DropdownMenuRadioGroup>
        </div>
        <div className="flex h-9 items-center justify-between gap-3 px-2">
          <span className="text-muted-foreground text-xs font-medium">{t('theme.label')}</span>
          <DropdownMenuRadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as ThemeMode)}
            className="bg-muted flex w-36 gap-0.5 rounded-md p-0.5"
          >
            <DropdownMenuSegment value="light" aria-label={t('theme.light')} title={t('theme.light')}>
              <Sun />
              <span className="sr-only">{t('theme.light')}</span>
            </DropdownMenuSegment>
            <DropdownMenuSegment value="dark" aria-label={t('theme.dark')} title={t('theme.dark')}>
              <Moon />
              <span className="sr-only">{t('theme.dark')}</span>
            </DropdownMenuSegment>
            <DropdownMenuSegment value="system" aria-label={t('theme.system')} title={t('theme.system')}>
              <Monitor />
              <span className="sr-only">{t('theme.system')}</span>
            </DropdownMenuSegment>
          </DropdownMenuRadioGroup>
        </div>

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="h-9">
          <a href="https://github.com/mdenizay/observi" target="_blank" rel="noreferrer noopener">
            <BookOpen />
            <span className="flex-1">{t('nav.docs')}</span>
            <ExternalLink className="size-3.5 opacity-60" />
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem destructive onSelect={logout} className="h-9">
          <LogOut />
          {t('nav.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
