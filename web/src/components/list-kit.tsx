import { MoreHorizontal, Pencil, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Panel } from '@/components/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n'

export function ListSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n()
  return (
    <div className="relative w-full sm:max-w-xs">
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('list.search')}
        aria-label={t('list.search')}
        className="pl-9"
      />
    </div>
  )
}

/** Framed panel holding rows separated by hairlines, with an optional mono column header. */
export function ListCard({
  children,
  title,
  head,
  className,
}: {
  children: React.ReactNode
  title?: React.ReactNode
  head?: [React.ReactNode, React.ReactNode?]
  className?: string
}) {
  return (
    <Panel title={title} className={className} bodyClassName="overflow-hidden">
      {head && (
        <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
          <span className="label-mono text-[10px]">{head[0]}</span>
          {head[1] && <span className="label-mono hidden pr-10 text-[10px] sm:inline">{head[1]}</span>}
        </div>
      )}
      <div className="divide-y">{children}</div>
    </Panel>
  )
}

export function ListRow({
  leading,
  title,
  subtitle,
  meta,
  actions,
  onClick,
}: {
  leading: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  meta?: React.ReactNode
  actions?: React.ReactNode
  onClick?: () => void
}) {
  return (
    <div className="hover:bg-foreground/[0.025] group flex items-center gap-3 px-4 py-3.5 transition-colors duration-150">
      {leading}
      <button
        type="button"
        onClick={onClick}
        className="focus-visible:ring-ring/50 min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-[3px]"
      >
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">{title}</div>
        {subtitle && <div className="text-muted-foreground mt-0.5 truncate text-xs">{subtitle}</div>}
      </button>
      {meta && <div className="hidden shrink-0 items-center gap-2 sm:flex">{meta}</div>}
      {actions}
    </div>
  )
}

export function RowActions({
  onEdit,
  onDelete,
  deleteDisabled,
}: {
  onEdit: () => void
  onDelete: () => void
  deleteDisabled?: boolean
}) {
  const { t } = useI18n()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={t('list.actions')} title={t('list.actions')}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil />
          {t('common.edit')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive disabled={deleteDisabled} onSelect={onDelete}>
          <Trash2 />
          {t('common.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <ListCard>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </ListCard>
  )
}
