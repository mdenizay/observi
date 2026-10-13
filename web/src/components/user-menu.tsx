import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronsUpDown, LogOut, Monitor, Moon, Settings, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/avatar'
import { Badge } from '@/components/ui/badge'
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
            className="focus-visible:ring-ring/50 rounded-full outline-none focus-visible:ring-[3px]"
          >
            <Avatar name={display} />
          </button>
        ) : (
          <button
            type="button"
            aria-label={t('usermenu.open')}
            className="bg-card shadow-card hover:border-border-strong data-[state=open]:border-border-strong focus-visible:ring-ring/40 flex w-full items-center gap-2.5 rounded-xl border p-2 text-left transition-colors outline-none focus-visible:ring-[3px]"
          >
            <Avatar name={display} />
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
        className="w-64 max-w-[calc(100vw-1.5rem)]"
      >
        <div className="flex items-center gap-2.5 px-2 py-2">
          <Avatar name={display} className="size-9" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{display}</div>
            <div className="text-muted-foreground truncate text-xs">@{user.username}</div>
          </div>
          <Badge variant={isAdmin ? 'default' : 'secondary'} className="shrink-0">
            {role}
          </Badge>
        </div>
        <DropdownMenuSeparator />

        <div className="flex items-center justify-between gap-3 px-2 py-1.5">
          <span className="text-muted-foreground text-xs font-medium">{t('lang.label')}</span>
          <DropdownMenuRadioGroup
            value={lang}
            onValueChange={(v) => setLang(v as Lang)}
            className="bg-muted flex w-40 gap-0.5 rounded-md p-0.5"
          >
            {LANGS.map((l) => (
              <DropdownMenuSegment key={l.code} value={l.code}>
                {l.label}
              </DropdownMenuSegment>
            ))}
          </DropdownMenuRadioGroup>
        </div>
        <div className="flex items-center justify-between gap-3 px-2 py-1.5">
          <span className="text-muted-foreground text-xs font-medium">{t('theme.label')}</span>
          <DropdownMenuRadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as ThemeMode)}
            className="bg-muted flex w-40 gap-0.5 rounded-md p-0.5"
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
        <DropdownMenuItem
          onSelect={() => {
            onNavigate?.()
            navigate('/settings')
          }}
        >
          <Settings />
          {t('nav.settings')}
        </DropdownMenuItem>
        <DropdownMenuItem destructive onSelect={logout}>
          <LogOut />
          {t('nav.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
