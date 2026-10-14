import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  ArrowUpCircle,
  Bell,
  CheckCheck,
  CircleCheck,
  CircleX,
  Globe,
  Lock,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useIsAdmin } from '@/hooks/use-auth'
import { useActivity } from '@/hooks/use-activity'
import { useNow } from '@/hooks/use-now'
import { useUpdateInfo } from '@/hooks/use-update'
import { useI18n } from '@/i18n'
import { errorMessage } from '@/lib/api'
import { formatDate, formatDuration, formatRelative } from '@/lib/format'
import { translateMessage } from '@/lib/messages'
import type { Activity } from '@/lib/types'
import { cn } from '@/lib/utils'

const kindStyle: Record<Activity['kind'], { icon: LucideIcon; cls: string }> = {
  down: { icon: CircleX, cls: 'text-down bg-down/10' },
  up: { icon: CircleCheck, cls: 'text-up bg-up/10' },
  ssl_expiring: { icon: Lock, cls: 'text-pending bg-pending/12' },
  ssl_expired: { icon: ShieldAlert, cls: 'text-down bg-down/10' },
  ssl_renewed: { icon: ShieldCheck, cls: 'text-up bg-up/10' },
  domain_expiring: { icon: Globe, cls: 'text-pending bg-pending/12' },
  domain_expired: { icon: Globe, cls: 'text-down bg-down/10' },
  domain_renewed: { icon: Globe, cls: 'text-up bg-up/10' },
}

function Item({ a, unread, now, onOpen }: { a: Activity; unread: boolean; now: number; onOpen: () => void }) {
  const { t, lang } = useI18n()
  const st = kindStyle[a.kind]
  const d = a.data
  const name = a.monitor_name
  let title: string
  let sub: string | null = null
  switch (a.kind) {
    case 'down':
      title = t('act.down', { name })
      sub = d?.message ? translateMessage(d.message, lang) : null
      break
    case 'up':
      title = t('act.up', { name })
      sub = d?.down_for_ms != null ? t('act.downFor', { duration: formatDuration(d.down_for_ms) }) : null
      break
    case 'ssl_expiring':
      title = t('act.sslExpiring', { name, count: Math.max(0, d?.days_left ?? 0) })
      sub = d?.expires_at ? t('ssl.validUntil', { date: formatDate(d.expires_at) }) : null
      break
    case 'ssl_expired':
      title = t('act.sslExpired', { name })
      sub = d?.expires_at ? t('ssl.expiredOn', { date: formatDate(d.expires_at) }) : null
      break
    case 'domain_expiring':
      title = t('act.domainExpiring', { domain: d?.domain ?? name, count: Math.max(0, d?.days_left ?? 0) })
      sub = d?.expires_at ? t('ssl.validUntil', { date: formatDate(d.expires_at) }) : null
      break
    case 'domain_expired':
      title = t('act.domainExpired', { domain: d?.domain ?? name })
      sub = d?.expires_at ? t('ssl.expiredOn', { date: formatDate(d.expires_at) }) : null
      break
    case 'domain_renewed':
      title = t('act.domainRenewed', { domain: d?.domain ?? name, date: d?.expires_at ? formatDate(d.expires_at) : '—' })
      break
    default:
      title = t('act.sslRenewed', { name })
      sub = d?.expires_at ? t('ssl.validUntil', { date: formatDate(d.expires_at) }) : null
  }
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'hover:bg-accent/60 focus-visible:bg-accent/60 flex w-full items-start gap-3 px-4 py-3 text-left transition-colors outline-none',
          unread && 'bg-primary/[0.04]',
        )}
      >
        <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full', st.cls)}>
          <st.icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug font-medium [overflow-wrap:anywhere]">{title}</span>
          {sub && <span className="text-muted-foreground mt-0.5 block text-xs [overflow-wrap:anywhere]">{sub}</span>}
        </span>
        <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 pt-0.5 text-xs whitespace-nowrap">
          {formatRelative(a.t, now)}
          {unread && <span className="bg-primary size-1.5 rounded-full" aria-hidden />}
        </span>
      </button>
    </li>
  )
}

/** Header bell: unread badge + "Recent activity" popover. */
export function ActivityBell() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()
  const now = useNow(30_000)
  const { items, unread, lastSeen, markAllRead, isPending, isError, error, refetch } = useActivity()
  const { data: update } = useUpdateInfo()
  const [open, setOpen] = useState(false)
  const [seenAtOpen, setSeenAtOpen] = useState(0) // snapshot so unread tint stays while the panel is open
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const toggle = () => {
    if (!open) {
      setSeenAtOpen(lastSeen)
      markAllRead()
    }
    setOpen((o) => !o)
  }
  const go = (to: string) => {
    setOpen(false)
    navigate(to)
  }
  const hasUpdate = isAdmin && !!update?.available && !!update.latest
  const badge = unread > 99 ? '99+' : String(unread)

  return (
    <div ref={rootRef} className="relative">
      <Button
        ref={btnRef}
        variant="ghost"
        size="icon-sm"
        className="relative"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread > 0 ? `${t('act.open')} — ${t('act.unreadBadge', { count: unread })}` : t('act.open')}
        onClick={toggle}
      >
        <Bell />
        {unread > 0 && (
          <span className="num bg-down absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold text-white">
            {badge}
          </span>
        )}
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label={t('act.title')}
          className="bg-popover text-popover-foreground shadow-pop z-50 flex max-h-[min(32rem,80dvh)] flex-col overflow-hidden rounded-xl border max-sm:fixed max-sm:inset-x-3 max-sm:top-14 sm:absolute sm:top-full sm:right-0 sm:mt-2 sm:w-96"
        >
          <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <h2 className="text-sm font-semibold">{t('act.title')}</h2>
            <Button size="xs" variant="ghost" onClick={markAllRead} disabled={items.length === 0}>
              <CheckCheck />
              {t('act.markRead')}
            </Button>
          </div>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            {hasUpdate && (
              <button
                type="button"
                onClick={() => go('/settings?tab=updates')}
                className="hover:bg-accent/60 flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors outline-none focus-visible:bg-accent/60"
              >
                <span className="text-up bg-up/10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full">
                  <ArrowUpCircle className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{t('act.updateTitle', { v: update!.latest! })}</span>
                  <span className="text-muted-foreground mt-0.5 block text-xs">{t('act.updateSub')}</span>
                </span>
              </button>
            )}
            {isPending ? (
              <div className="grid gap-4 p-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="bg-muted size-7 animate-pulse rounded-full" />
                    <div className="bg-muted h-8 flex-1 animate-pulse rounded-md" />
                  </div>
                ))}
              </div>
            ) : isError ? (
              <div className="flex flex-col items-center gap-3 px-4 py-8 text-center text-sm">
                <span className="text-muted-foreground">
                  {t('act.failed')} {errorMessage(error)}
                </span>
                <Button size="sm" variant="outline" onClick={() => refetch()}>
                  {t('common.retry')}
                </Button>
              </div>
            ) : items.length === 0 && !hasUpdate ? (
              <div className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-10 text-sm">
                <span className="bg-muted flex size-10 items-center justify-center rounded-full">
                  <Bell className="size-5" />
                </span>
                {t('act.empty')}
              </div>
            ) : (
              <ul className="divide-y">
                {items.map((a) => (
                  <Item
                    key={a.id}
                    a={a}
                    now={now}
                    unread={a.t > seenAtOpen}
                    onOpen={() => go(`/dashboard/${a.monitor_id}`)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
