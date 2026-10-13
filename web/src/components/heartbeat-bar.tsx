import { memo } from 'react'
import { useWidth } from '@/hooks/use-width'
import { getLang, useI18n } from '@/i18n'
import { beatLabel, formatDateTime, formatLatency } from '@/lib/format'
import { translateMessage } from '@/lib/messages'
import type { Beat } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * Pixel heartbeat history: one small square per check, oldest on the left.
 * Healthy checks are neutral ink; only anomalies get colour so problems pop out.
 */
const cellColor: Record<number, string> = {
  0: 'bg-down',
  1: 'bg-cell-ok',
  2: 'bg-pending',
  3: 'bg-paused/40',
}

const sizes = {
  xs: { c: 6, gap: 2 },
  sm: { c: 8, gap: 2 },
  md: { c: 9, gap: 2 },
  lg: { c: 10, gap: 3 },
} as const

interface Props {
  beats: Beat[]
  /** Maximum number of cells (fewer if the width doesn't fit). */
  max?: number
  size?: keyof typeof sizes
  /** Spread the cells over the full width. */
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
  const fit = width > 0 ? Math.max(1, Math.floor((width + s.gap) / (s.c + s.gap))) : max
  const count = Math.min(max, fit)
  const shown = beats.slice(-count)
  const empty = count - shown.length

  return (
    <div
      ref={ref}
      className={cn('flex w-full items-center overflow-hidden', stretch ? 'justify-between' : 'justify-end', className)}
      style={{ gap: stretch ? undefined : s.gap, height: s.c }}
      role="img"
      aria-label={t('heartbeat.recent')}
    >
      {Array.from({ length: empty }, (_, i) => (
        <span key={`e${i}`} className="bg-cell-empty shrink-0 rounded-[2px]" style={{ width: s.c, height: s.c }} />
      ))}
      {shown.map((b) => (
        <span
          key={b.t}
          title={beatTitle(b)}
          className={cn('shrink-0 rounded-[2px] transition-transform duration-150 hover:scale-125', cellColor[b.s] ?? 'bg-cell-empty')}
          style={{ width: s.c, height: s.c }}
        />
      ))}
    </div>
  )
})
