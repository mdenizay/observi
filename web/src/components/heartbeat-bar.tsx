import { memo } from 'react'
import { useWidth } from '@/hooks/use-width'
import { beatLabel, formatDateTime, formatLatency } from '@/lib/format'
import { translateMessage } from '@/lib/messages'
import type { Beat } from '@/lib/types'
import { cn } from '@/lib/utils'
import { getLang, useI18n } from '@/i18n'

const color: Record<number, string> = {
  0: 'bg-down',
  1: 'bg-up',
  2: 'bg-pending',
  3: 'bg-paused',
}

const sizes = {
  sm: { w: 4, h: 16, gap: 2, cls: 'rounded-full' },
  md: { w: 6, h: 22, gap: 2, cls: 'rounded-full' },
  lg: { w: 8, h: 28, gap: 3, cls: 'rounded-full' },
} as const

interface Props {
  beats: Beat[]
  /** Maximum number of slots to render (fewer if the width doesn't fit). */
  max?: number
  size?: keyof typeof sizes
  /** Pills share the full width evenly instead of using a fixed width. */
  stretch?: boolean
  className?: string
}

function beatTitle(b: Beat) {
  const parts = [formatDateTime(b.t), beatLabel(b.s)]
  if (b.l !== null && b.l !== undefined) parts.push(formatLatency(b.l))
  if (b.m) parts.push(translateMessage(b.m, getLang()))
  return parts.join(' · ')
}

export const HeartbeatBar = memo(function HeartbeatBar({ beats, max = 30, size = 'sm', stretch = false, className }: Props) {
  const { t } = useI18n() // also re-renders this memoized bar when the language changes
  const [ref, width] = useWidth<HTMLDivElement>()
  const s = sizes[size]
  const minW = stretch ? 3 : s.w
  const fit = width > 0 ? Math.max(1, Math.floor((width + s.gap) / (minW + s.gap))) : max
  const count = Math.min(max, fit)
  const shown = beats.slice(-count)
  const empty = count - shown.length

  return (
    <div
      ref={ref}
      className={cn('flex w-full items-center overflow-hidden', stretch ? '' : 'justify-end', className)}
      style={{ gap: s.gap, height: s.h }}
      role="img"
      aria-label={t('heartbeat.recent')}
    >
      {Array.from({ length: empty }, (_, i) => (
        <span key={`e${i}`} className={cn('bg-empty', stretch ? 'min-w-0 flex-1' : 'shrink-0', s.cls)}
          style={stretch ? { height: s.h } : { width: s.w, height: s.h }} />
      ))}
      {shown.map((b) => (
        <span
          key={b.t}
          title={beatTitle(b)}
          className={cn(
            'transition-opacity hover:opacity-70',
            stretch ? 'min-w-0 flex-1' : 'shrink-0',
            color[b.s] ?? 'bg-empty',
            s.cls,
          )}
          style={stretch ? { height: s.h } : { width: s.w, height: s.h }}
        />
      ))}
    </div>
  )
})
