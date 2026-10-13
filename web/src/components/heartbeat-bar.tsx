import { memo } from 'react'
import { useWidth } from '@/hooks/use-width'
import { getLang, useI18n } from '@/i18n'
import { beatLabel, formatDateTime, formatLatency } from '@/lib/format'
import { translateMessage } from '@/lib/messages'
import type { Beat } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * Heartbeat history as a row of thin rounded bars, oldest on the left.
 * Healthy checks are neutral grey so failures (red) and pending (amber) stand out.
 */
const barColor: Record<number, string> = {
  0: 'bg-down',
  1: 'bg-bar-ok',
  2: 'bg-pending',
  3: 'bg-paused/40',
}

const sizes = {
  xs: { w: 3, h: 16, gap: 2 },
  sm: { w: 4, h: 22, gap: 3 },
  md: { w: 5, h: 26, gap: 3 },
  lg: { w: 6, h: 32, gap: 3 },
} as const

interface Props {
  beats: Beat[]
  /** Maximum number of bars (fewer if the width doesn't fit). */
  max?: number
  size?: keyof typeof sizes
  /** Spread the bars over the full width. */
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
  const fit = width > 0 ? Math.max(1, Math.floor((width + s.gap) / (s.w + s.gap))) : max
  const count = Math.min(max, fit)
  const shown = beats.slice(-count)
  const empty = count - shown.length

  return (
    <div
      ref={ref}
      className={cn('flex w-full items-center overflow-hidden', stretch ? 'justify-between' : 'justify-end', className)}
      style={{ gap: stretch ? undefined : s.gap, height: s.h }}
      role="img"
      aria-label={t('heartbeat.recent')}
    >
      {Array.from({ length: empty }, (_, i) => (
        <span key={`e${i}`} className="bg-bar-empty shrink-0 rounded-full" style={{ width: s.w, height: s.h }} />
      ))}
      {shown.map((b) => (
        <span
          key={b.t}
          title={beatTitle(b)}
          className={cn('shrink-0 rounded-full transition-opacity duration-150 hover:opacity-70', barColor[b.s] ?? 'bg-bar-empty')}
          style={{ width: s.w, height: s.h }}
        />
      ))}
    </div>
  )
})
