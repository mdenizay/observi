import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

export function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: React.ReactNode
  htmlFor?: string
  hint?: React.ReactNode
  error?: string | null
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-destructive text-xs">{error}</p>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  )
}

export function SwitchField({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  className,
}: {
  id: string
  label: React.ReactNode
  description?: React.ReactNode
  checked: boolean
  onCheckedChange: (v: boolean) => void
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 rounded-lg border px-3 py-2.5', className)}>
      <div className="grid gap-1">
        <Label htmlFor={id} className="cursor-pointer">
          {label}
        </Label>
        {description && <p className="text-muted-foreground text-xs">{description}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}
