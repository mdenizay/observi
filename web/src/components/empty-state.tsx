import { Activity, Bell, Folder, SearchX, Users, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type Kind = 'monitors' | 'search' | 'users' | 'groups' | 'notifications'

const icons: Record<Kind, LucideIcon> = {
  monitors: Activity,
  search: SearchX,
  users: Users,
  groups: Folder,
  notifications: Bell,
}

export function EmptyState({
  kind,
  title,
  description,
  action,
  className,
}: {
  kind: Kind
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  const Icon = icons[kind]
  return (
    <div className={cn('flex flex-col items-center gap-4 px-6 py-14 text-center', className)}>
      <div className="bg-muted text-muted-foreground relative flex size-14 items-center justify-center rounded-2xl">
        <div className="bg-foreground/5 absolute inset-0 -z-0 scale-150 rounded-full blur-xl" aria-hidden />
        <Icon className="relative size-6" />
      </div>
      <div className="grid max-w-sm gap-1">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </div>
      {action}
    </div>
  )
}
