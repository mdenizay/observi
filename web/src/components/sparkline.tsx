import { memo } from 'react'
import type { Beat } from '@/lib/types'

/** Tiny latency sparkline drawn from the beats' `l` values (gaps where there's no latency). */
export const Sparkline = memo(function Sparkline({
  beats,
  width = 88,
  height = 24,
  className,
}: {
  beats: Beat[]
  width?: number
  height?: number
  className?: string
}) {
  const pts = beats.map((b) => (b.s === 1 || b.s === 2) && b.l != null ? b.l : null)
  const vals = pts.filter((v): v is number => v !== null)
  if (vals.length < 2) return <svg width={width} height={height} className={className} aria-hidden />
  const max = Math.max(...vals)
  const min = Math.min(...vals)
  const span = max - min || 1
  const step = width / Math.max(1, pts.length - 1)
  let d = ''
  let pen = false
  pts.forEach((v, i) => {
    if (v === null) {
      pen = false
      return
    }
    const x = (i * step).toFixed(1)
    const y = (height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)
    d += `${pen ? 'L' : 'M'}${x},${y}`
    pen = true
  })
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <path d={d} fill="none" stroke="var(--chart)" strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
})
