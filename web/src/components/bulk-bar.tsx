import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellMinus, BellPlus, FolderInput, Loader2, MoreHorizontal, Pause, Play, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { GroupCombobox } from '@/components/group-combobox'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { api, errorMessage } from '@/lib/api'
import type { BulkAction } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Popover to pick a notification channel and add it to / remove it from the selection. */
function NotifyPopover({ disabled, onApply }: { disabled: boolean; onApply: (action: 'notify_add' | 'notify_remove', id: number, name: string) => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const q = useQuery({ queryKey: ['notifications'], queryFn: api.notifications, enabled: open })

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false))
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const chosen = q.data?.find((n) => n.id === picked)
  return (
    <div ref={ref} className="relative inline-block">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('bulk.notifications')}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell />
        <span className="max-sm:sr-only">{t('bulk.notifications')}</span>
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label={t('bulk.notifications')}
          className="bg-popover text-popover-foreground shadow-pop absolute bottom-full left-0 z-50 mb-1.5 w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border"
        >
          <div className="text-muted-foreground border-b px-3 py-2 text-xs">{t('bulk.pickChannel')}</div>
          <ul role="listbox" aria-label={t('bulk.pickChannel')} className="scrollbar-thin max-h-48 overflow-y-auto p-1">
            {q.isPending && <li className="text-muted-foreground flex justify-center p-4"><Loader2 className="size-4 animate-spin" /></li>}
            {q.data?.length === 0 && <li className="text-muted-foreground px-3 py-5 text-center text-sm">{t('bulk.noChannels')}</li>}
            {q.data?.map((n) => (
              <li key={n.id} role="option" aria-selected={n.id === picked}>
                <button
                  type="button"
                  onClick={() => setPicked(n.id)}
                  className={cn(
                    'hover:bg-accent flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm',
                    n.id === picked && 'bg-accent',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{n.name}</span>
                  <span className="text-muted-foreground text-xs">{n.kind}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 border-t p-2">
            <Button
              size="sm"
              className="flex-1"
              disabled={!chosen}
              onClick={() => {
                if (chosen) {
                  onApply('notify_add', chosen.id, chosen.name)
                  setOpen(false)
                }
              }}
            >
              <BellPlus />
              {t('bulk.addTo')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={!chosen}
              onClick={() => {
                if (chosen) {
                  onApply('notify_remove', chosen.id, chosen.name)
                  setOpen(false)
                }
              }}
            >
              <BellMinus />
              {t('bulk.removeFrom')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Floating action bar for the dashboard's bulk selection (superadmin only). */
export function BulkBar({
  ids,
  onClear,
  groupName,
}: {
  ids: number[]
  onClear: () => void
  groupName: (id: number | null) => string
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const count = ids.length

  const run = async (
    action: BulkAction,
    extra: { group_id?: number | null; notification_id?: number },
    message: (n: number) => string,
  ) => {
    setBusy(true)
    try {
      const { affected } = await api.bulkMonitors({ ids, action, ...extra })
      toast.success(message(affected))
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['monitors'] }),
        qc.invalidateQueries({ queryKey: ['groups'] }),
      ])
      qc.invalidateQueries({ queryKey: ['monitor'] })
      onClear()
    } catch (e) {
      toast.error(errorMessage(e))
      throw e
    } finally {
      setBusy(false)
    }
  }
  const quiet = (p: Promise<void>) => p.catch(() => {})

  const move = (v: string) => {
    const gid = v === 'none' ? null : Number(v)
    void quiet(
      run('move', { group_id: gid }, (n) =>
        gid === null ? t('bulk.ungrouped', { count: n }) : t('bulk.moved', { count: n, group: groupName(gid) }),
      ),
    )
  }
  const notify = (action: 'notify_add' | 'notify_remove', id: number, name: string) =>
    void quiet(
      run(action, { notification_id: id }, (n) =>
        action === 'notify_add' ? t('bulk.notifyAdded', { count: n, channel: name }) : t('bulk.notifyRemoved', { count: n, channel: name }),
      ),
    )

  return (
    <>
      <div
        role="toolbar"
        aria-label={t('bulk.selected', { count })}
        className="bg-popover text-popover-foreground shadow-pop sticky bottom-4 z-30 mx-auto flex w-fit max-w-full items-center gap-2 rounded-xl border p-2 pl-3.5"
      >
        <span className="num text-sm font-medium whitespace-nowrap" aria-live="polite">
          {t('bulk.selected', { count })}
        </span>
        <Button size="sm" variant="ghost" onClick={onClear} disabled={busy} aria-label={t('bulk.clear')}>
          <X className="sm:hidden" />
          <span className="max-sm:sr-only">{t('bulk.clear')}</span>
        </Button>
        <span className="bg-border mx-0.5 h-5 w-px" aria-hidden />
        <GroupCombobox
          actionLabel={t('bulk.move')}
          actionIcon={FolderInput}
          placement="top"
          disabled={busy}
          onChange={move}
        />
        <NotifyPopover disabled={busy} onApply={notify} />
        <Button
          size="sm"
          variant="outline"
          className="hidden sm:inline-flex"
          disabled={busy}
          onClick={() => void quiet(run('pause', {}, (n) => t('bulk.paused', { count: n })))}
        >
          <Pause />
          {t('bulk.pause')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="hidden sm:inline-flex"
          disabled={busy}
          onClick={() => void quiet(run('resume', {}, (n) => t('bulk.resumed', { count: n })))}
        >
          <Play />
          {t('bulk.resume')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-destructive hover:text-destructive hidden sm:inline-flex"
          disabled={busy}
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 />
          {t('bulk.delete')}
        </Button>
        <div className="sm:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="outline" disabled={busy} aria-label={t('bulk.more')}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="min-w-40">
              <DropdownMenuItem onSelect={() => void quiet(run('pause', {}, (n) => t('bulk.paused', { count: n })))}>
                <Pause />
                {t('bulk.pause')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void quiet(run('resume', {}, (n) => t('bulk.resumed', { count: n })))}>
                <Play />
                {t('bulk.resume')}
              </DropdownMenuItem>
              <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)}>
                <Trash2 />
                {t('bulk.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('bulk.deleteTitle', { count })}
        description={t('bulk.deleteDesc')}
        onConfirm={() => run('delete', {}, (n) => t('bulk.deleted', { count: n }))}
      />
    </>
  )
}
