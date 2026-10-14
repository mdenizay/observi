import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronsUpDown, Loader2, Plus, Search, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useGroups } from '@/hooks/use-groups'
import { useI18n } from '@/i18n'
import { api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Option {
  id: string
  label: string
  kind: 'none' | 'group' | 'create'
}

/**
 * Searchable group picker with inline group creation.
 * `value` is '' / 'none' for ungrouped, otherwise a group id string.
 */
export function GroupCombobox({
  id,
  value,
  onChange,
  fallbackName,
  actionLabel,
  actionIcon: ActionIcon,
  placement = 'bottom',
  disabled,
}: {
  id?: string
  value?: string
  onChange: (v: string) => void
  /** Name to show for the current value while groups are still loading. */
  fallbackName?: string | null
  /** Action mode: render a button with this label instead of a field; `onChange` fires on pick. */
  actionLabel?: string
  actionIcon?: LucideIcon
  placement?: 'top' | 'bottom'
  disabled?: boolean
}) {
  value = value ?? ''
  const actionMode = !!actionLabel
  const { t, lang } = useI18n()
  const qc = useQueryClient()
  const groups = useGroups()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()

  const ungrouped = value === '' || value === 'none'
  const current = groups.data?.find((g) => String(g.id) === value)
  const triggerLabel = ungrouped
    ? t('dash.ungrouped')
    : (current?.name ?? fallbackName ?? t('dash.groupFallback', { id: value }))

  const options = useMemo<Option[]>(() => {
    const term = q.trim().toLocaleLowerCase(lang)
    const list: Option[] = []
    const all: Option[] = [
      { id: 'none', label: t('dash.ungrouped'), kind: 'none' },
      ...(groups.data ?? []).map((g) => ({ id: String(g.id), label: g.name, kind: 'group' as const })),
    ]
    const filtered = all.filter((o) => !term || o.label.toLocaleLowerCase(lang).includes(term))
    const exact = (groups.data ?? []).some((g) => g.name.trim().toLocaleLowerCase(lang) === term)
    if (term && !exact) list.push({ id: 'create', label: q.trim(), kind: 'create' })
    return [...list, ...filtered]
  }, [q, groups.data, lang, t])

  useEffect(() => setActive(0), [q, open])
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function close(refocus = true) {
    setOpen(false)
    setQ('')
    setError(null)
    if (refocus) triggerRef.current?.focus()
  }

  const create = async (name: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.createGroup({ name })
      await qc.invalidateQueries({ queryKey: ['groups'] })
      onChange(String(res.id))
      toast.success(t('groups.created'))
      close()
    } catch (e) {
      const msg = errorMessage(e)
      setError(msg)
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  const choose = (o: Option) => {
    if (busy) return
    if (o.kind === 'create') return void create(o.label)
    onChange(o.id)
    close()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(options.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (options[active]) choose(options[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'Tab') {
      close(false)
    }
  }

  return (
    <div ref={rootRef} className={cn('relative', actionMode && 'inline-block')}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault()
            setOpen(true)
          }
        }}
        aria-label={actionMode ? actionLabel : undefined}
        className={
          actionMode
            ? 'bg-card hover:bg-accent focus-visible:ring-ring/50 inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium shadow-xs transition-colors outline-none focus-visible:ring-[3px] disabled:opacity-50'
            : 'border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]'
        }
      >
        {actionMode ? (
          <>
            {ActionIcon && <ActionIcon className="size-4" />}
            <span className="max-sm:sr-only">{actionLabel}</span>
          </>
        ) : (
          <>
            <span className={cn('truncate', ungrouped && 'text-muted-foreground')}>{triggerLabel}</span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </>
        )}
      </button>

      {open && (
        <div
          className={cn(
            'bg-popover text-popover-foreground shadow-pop absolute z-50 overflow-hidden rounded-lg border',
            actionMode ? 'w-72 max-w-[calc(100vw-1.5rem)]' : 'w-full min-w-56',
            placement === 'top' ? 'bottom-full mb-1.5' : 'mt-1.5',
            actionMode && 'left-0',
          )}
        >
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="text-muted-foreground size-4 shrink-0" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setError(null)
              }}
              onKeyDown={onKeyDown}
              placeholder={t('combo.search')}
              aria-label={t('combo.search')}
              aria-controls={listId}
              aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
              maxLength={80}
              className="placeholder:text-muted-foreground h-10 w-full bg-transparent text-sm outline-none"
            />
            {busy && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
          </div>
          <ul ref={listRef} id={listId} role="listbox" className="scrollbar-thin max-h-60 overflow-y-auto p-1">
            {options.length === 0 && (
              <li className="text-muted-foreground px-3 py-6 text-center text-sm">{t('combo.noGroups')}</li>
            )}
            {options.map((o, i) => {
              const selected = !actionMode && o.kind !== 'create' && (o.id === 'none' ? ungrouped : o.id === value)
              return (
                <li
                  key={`${o.kind}-${o.id}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={selected}
                  data-index={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(o)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm',
                    i === active && 'bg-accent text-accent-foreground',
                  )}
                >
                  {o.kind === 'create' ? (
                    <>
                      <Plus className="size-4 shrink-0" />
                      <span className="min-w-0 truncate">{t('combo.create', { name: o.label })}</span>
                    </>
                  ) : (
                    <>
                      <span className={cn('min-w-0 flex-1 truncate', o.kind === 'none' && 'text-muted-foreground')}>
                        {o.label}
                      </span>
                      {selected && <Check className="size-4 shrink-0" />}
                    </>
                  )}
                </li>
              )
            })}
          </ul>
          {error && <p className="text-destructive border-t px-3 py-2 text-xs">{error}</p>}
        </div>
      )}
    </div>
  )
}
