import { Folder } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { useI18n } from '@/i18n'
import type { Group } from '@/lib/types'

export function GroupChecklist({
  groups,
  value,
  onChange,
}: {
  groups: Group[]
  value: number[]
  onChange: (ids: number[]) => void
}) {
  const { t } = useI18n()
  if (!groups.length)
    return <div className="text-muted-foreground rounded-lg border px-3 py-2.5 text-sm">{t('users.noGroups')}</div>
  return (
    <div className="max-h-36 overflow-y-auto rounded-lg border p-1">
      {groups.map((g) => (
        <label
          key={g.id}
          className="hover:bg-accent/60 flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm"
        >
          <Checkbox
            checked={value.includes(g.id)}
            onCheckedChange={(v) => onChange(v === true ? [...value, g.id] : value.filter((x) => x !== g.id))}
          />
          <Folder className="text-muted-foreground size-3.5" />
          <span className="truncate">{g.name}</span>
          <span className="text-muted-foreground ml-auto text-xs tabular-nums">{t('monitors.count', { count: g.monitor_ids.length })}</span>
        </label>
      ))}
    </div>
  )
}
