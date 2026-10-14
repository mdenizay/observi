import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, Search, Tag as TagIcon, X } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { useI18n } from '@/i18n'
import { useTagList } from '@/hooks/use-tags'
import { cn } from '@/lib/utils'

export const TAG_MAX = 30
export const TAGS_MAX = 20

/** Deterministic hue (0–359) per tag name. */
function hue(name: string) {
  let h = 0
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

function chipStyle(name: string): React.CSSProperties {
  const h = hue(name)
  return {
    backgroundColor: `light-dark(oklch(0.95 0.035 ${h}), oklch(0.32 0.045 ${h}))`,
    color: `light-dark(oklch(0.42 0.09 ${h}), oklch(0.86 0.07 ${h}))`,
  }
}

export function TagChip({
  name,
  onRemove,
  removeLabel,
  className,
}: {
  name: string
  onRemove?: () => void
  removeLabel?: string
  className?: string
}) {
  return (
    <span
      style={chipStyle(name)}
      title={name}
      className={cn('inline-flex h-5 min-w-0 max-w-full shrink items-center gap-1 rounded-full px-2 text-[11px] leading-none font-medium', className)}
    >
      <span className="truncate">{name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="-mr-1 inline-flex size-3.5 shrink-0 items-center justify-center rounded-full opacity-70 hover:opacity-100 focus-visible:opacity-100"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  )
}

/** Read-only single-line chip row (first `max` tags + "+N"). */
export function TagChips({ tags, max = 3, className }: { tags: string[] | undefined; max?: number; className?: string }) {
  if (!tags?.length) return null
  const shown = tags.slice(0, max)
  const rest = tags.length - shown.length
  return (
    <span className={cn('flex min-w-0 items-center gap-1 overflow-hidden', className)}>
      {shown.map((t) => (
        <TagChip key={t} name={t} className="max-w-24" />
      ))}
      {rest > 0 && (
        <span className="text-muted-foreground num shrink-0 text-[11px]" title={tags.slice(max).join(', ')}>
          +{rest}
        </span>
      )}
    </span>
  )
}

/** Chips input with autocomplete (Enter/comma adds, Backspace removes the last). */
export function TagsInput({ id, value, onChange }: { id?: string; value: string[]; onChange: (v: string[]) => void }) {
  const { t, lang } = useI18n()
  const known = useTagList()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const lower = (s: string) => s.toLocaleLowerCase(lang)
  const has = (n: string) => value.some((v) => lower(v) === lower(n))
  const suggestions = useMemo(() => {
    const q = lower(text.trim())
    return (known.data ?? []).filter((k) => !has(k.name) && (!q || lower(k.name).includes(q))).slice(0, 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [known.data, text, value, lang])

  useEffect(() => setActive(0), [text])
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const add = (raw: string) => {
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, TAG_MAX)
    if (!name || has(name) || value.length >= TAGS_MAX) return
    onChange([...value, name])
    setText('')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (open && suggestions[active] && e.key === 'Enter' && !text.trim()) add(suggestions[active].name)
      else if (open && suggestions[active] && lower(suggestions[active].name) === lower(text.trim())) add(suggestions[active].name)
      else add(text)
    } else if (e.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1))
    } else if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(suggestions.length - 1, a + 1))
    } else if (e.key === 'ArrowUp' && suggestions.length) {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Tab' && open && suggestions[active] && text.trim()) {
      e.preventDefault()
      add(suggestions[active].name)
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <div
        onClick={() => inputRef.current?.focus()}
        className="border-input dark:bg-input/30 focus-within:border-ring focus-within:ring-ring/50 flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-2 py-1.5 shadow-xs transition-[color,box-shadow] focus-within:ring-[3px]"
      >
        {value.map((v) => (
          <TagChip key={v} name={v} className="h-6 text-xs" removeLabel={t('tags.remove', { tag: v })} onRemove={() => onChange(value.filter((x) => x !== v))} />
        ))}
        <input
          ref={inputRef}
          id={id}
          value={text}
          maxLength={TAG_MAX}
          disabled={value.length >= TAGS_MAX}
          onChange={(e) => {
            setText(e.target.value.replace(/,/g, ''))
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => text.trim() && add(text)}
          onKeyDown={onKeyDown}
          placeholder={value.length ? '' : t('tags.placeholder')}
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          className="placeholder:text-muted-foreground min-w-24 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="bg-popover text-popover-foreground shadow-pop absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border p-1"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.name}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(s.name)}
              onMouseMove={() => setActive(i)}
              className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm', i === active && 'bg-accent')}
            >
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="text-muted-foreground num text-xs">{s.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Toolbar tag filter: popover multi-select with counts (OR semantics). */
export function TagFilter({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { t, lang } = useI18n()
  const known = useTagList()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false)
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

  const all = known.data ?? []
  if (all.length === 0 && value.length === 0) return null
  const term = q.trim().toLocaleLowerCase(lang)
  const list = all.filter((x) => !term || x.name.toLocaleLowerCase(lang).includes(term))
  const toggle = (n: string) => onChange(value.includes(n) ? value.filter((x) => x !== n) : [...value, n])

  return (
    <div ref={rootRef} className="relative flex flex-wrap items-center gap-1.5">
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'focus-visible:ring-ring/50 bg-card hover:bg-accent inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium shadow-xs transition-colors outline-none focus-visible:ring-[3px]',
          value.length > 0 && 'border-foreground/50',
        )}
      >
        <TagIcon className="size-3.5" />
        {t('tags.filter')}
        {value.length > 0 && <span className="num bg-foreground text-background rounded-full px-1.5 text-[11px]">{value.length}</span>}
      </button>
      {value.map((v) => (
        <TagChip key={v} name={v} className="h-6 text-xs" removeLabel={t('tags.remove', { tag: v })} onRemove={() => toggle(v)} />
      ))}
      {open && (
        <div
          role="dialog"
          aria-label={t('tags.filter')}
          className="bg-popover text-popover-foreground shadow-pop absolute top-full left-0 z-40 mt-1.5 w-64 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border"
        >
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="text-muted-foreground size-4 shrink-0" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('tags.search')}
              aria-label={t('tags.search')}
              className="placeholder:text-muted-foreground h-9 w-full bg-transparent text-sm outline-none"
            />
          </div>
          <ul className="scrollbar-thin max-h-56 overflow-y-auto p-1">
            {list.length === 0 && <li className="text-muted-foreground px-3 py-5 text-center text-sm">{t('tags.none')}</li>}
            {list.map((x) => (
              <li key={x.name}>
                <label className="hover:bg-accent flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm">
                  <Checkbox checked={value.includes(x.name)} onCheckedChange={() => toggle(x.name)} />
                  <span className="min-w-0 flex-1 truncate">{x.name}</span>
                  <span className="text-muted-foreground num text-xs">{x.count}</span>
                </label>
              </li>
            ))}
          </ul>
          {value.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 border-t px-3 py-2 text-xs"
            >
              <Check className="size-3.5" />
              {t('tags.clearAll')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
