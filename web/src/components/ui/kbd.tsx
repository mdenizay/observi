import { cn } from '@/lib/utils'

export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'bg-muted text-muted-foreground inline-flex h-5 min-w-5 items-center justify-center rounded-md border px-1 text-[10px] leading-none font-medium',
        className,
      )}
      {...props}
    />
  )
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
