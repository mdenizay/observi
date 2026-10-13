import { useId, useMemo, useState } from 'react'
import { useWidth } from '@/hooks/use-width'
import { useI18n } from '@/i18n'
import { formatDateTime, formatDay, formatLatency, formatTime } from '@/lib/format'
import type { Beat } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * Dot-matrix column chart: the series is bucketed into columns of small square
 * cells, filled up to the bucket's average latency. Columns that contain failed
 * checks are drawn in red; a faint grid of empty cells sits behind everything.
 */

interface Props {
  beats: Beat[]
  hours: number
  height?: number
  className?: string
}

const CELL = 6
const GAP = 2
const PITCH = CELL + GAP
const PAD = { top: 10, right: 4, bottom: 22, left: 40 }

interface Col {
  t0: number
  t1: number
  avg: number | null
  down: number
  pending: number
  n: number
}

function niceMax(v: number) {
  if (v <= 0) return 100
  const exp = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / exp
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nf * exp
}

function fmtAxisMs(v: number) {
  if (v >= 1000) return `${+(v / 1000).toFixed(1)}s`
  return `${Math.round(v)}`
}

export function LatencyChart({ beats, hours, height = 220, className }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const { t, lang } = useI18n()
  const pid = `cells${useId().replace(/:/g, '')}`

  const model = useMemo(() => {
    if (width <= 0 || beats.length === 0) return null
    const cols = Math.max(4, Math.floor((width - PAD.left - PAD.right + GAP) / PITCH))
    const rows = Math.max(4, Math.floor((height - PAD.top - PAD.bottom + GAP) / PITCH))
    const plotW = cols * PITCH - GAP
    const plotH = rows * PITCH - GAP
    const x0 = PAD.left
    const y0 = PAD.top

    const tStart = beats[0].t
    const tEnd = Math.max(beats[beats.length - 1].t, tStart + 1)
    const span = (tEnd - tStart) / cols
    const buckets: Col[] = Array.from({ length: cols }, (_, i) => ({
      t0: tStart + i * span,
      t1: tStart + (i + 1) * span,
      avg: null,
      down: 0,
      pending: 0,
      n: 0,
    }))
    const sums = new Array(cols).fill(0)
    const cnts = new Array(cols).fill(0)
    for (const b of beats) {
      const i = Math.min(cols - 1, Math.floor((b.t - tStart) / span))
      const c = buckets[i]
      c.n++
      if (b.s === 0) c.down++
      else if (b.s === 2) c.pending++
      if (b.l != null && b.s !== 0) {
        sums[i] += b.l
        cnts[i]++
      }
    }
    buckets.forEach((c, i) => (c.avg = cnts[i] ? sums[i] / cnts[i] : null))
    const maxAvg = Math.max(0, ...buckets.map((c) => c.avg ?? 0))
    const yMax = niceMax(maxAvg * 1.1 || 100)

    const filled = buckets.map((c) => (c.down ? rows : c.avg === null ? 0 : Math.max(1, Math.round((c.avg / yMax) * rows))))
    const yTicks = [0, 0.5, 1].map((f) => ({ v: yMax * f, y: y0 + plotH - f * plotH }))
    const nX = Math.max(2, Math.min(5, Math.floor(plotW / 110)))
    const showDay = hours > 24
    const xTicks = Array.from({ length: nX }, (_, i) => {
      const col = Math.round(((cols - 1) * i) / (nX - 1))
      const tt = buckets[col].t0
      return {
        x: x0 + col * PITCH + CELL / 2,
        label: showDay ? `${formatDay(tt)}${hours <= 168 ? ` ${formatTime(tt)}` : ''}` : formatTime(tt),
      }
    })
    return { cols, rows, plotW, plotH, x0, y0, buckets, filled, yTicks, xTicks, yMax }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beats, width, height, hours, lang])

  // Static cell layer (memoised so hover only re-renders the overlay).
  const cells = useMemo(() => {
    if (!model) return null
    const out: React.ReactNode[] = []
    model.buckets.forEach((c, i) => {
      const h = model.filled[i]
      const x = model.x0 + i * PITCH
      for (let r = 0; r < h; r++) {
        const y = model.y0 + model.plotH - (r + 1) * PITCH + GAP
        const top = r === h - 1
        out.push(
          <rect
            key={`${i}-${r}`}
            x={x}
            y={y}
            width={CELL}
            height={CELL}
            rx={1.5}
            fill={c.down ? 'var(--down)' : top ? (c.pending ? 'var(--pending)' : 'var(--cell-ink)') : 'var(--cell-ok)'}
            fillOpacity={c.down ? (top ? 0.95 : 0.4) : 1}
          />,
        )
      }
    })
    return out
  }, [model])

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!model) return
    const rect = e.currentTarget.getBoundingClientRect()
    const i = Math.floor((e.clientX - rect.left - model.x0) / PITCH)
    setHover(i >= 0 && i < model.cols && model.buckets[i].n > 0 ? i : null)
  }

  const hb = hover !== null && model ? model.buckets[hover] : null
  const hx = hb && model ? model.x0 + hover! * PITCH + CELL / 2 : 0
  const hy = hb && model ? model.y0 + model.plotH - model.filled[hover!] * PITCH + GAP - 1 : 0

  return (
    <div ref={ref} className={cn('relative w-full select-none', className)} style={{ height }}>
      {beats.length === 0 && (
        <div className="text-muted-foreground absolute inset-0 flex items-center justify-center text-sm">
          {t('chart.noData')}
        </div>
      )}
      {model && (
        <svg
          width={width}
          height={height}
          className="block touch-none"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <pattern id={pid} x={model.x0} y={model.y0} width={PITCH} height={PITCH} patternUnits="userSpaceOnUse">
              <rect width={CELL} height={CELL} rx={1.5} fill="var(--cell-empty)" />
            </pattern>
          </defs>
          <rect x={model.x0} y={model.y0} width={model.plotW} height={model.plotH} fill={`url(#${pid})`} />

          {model.yTicks.map((tk) => (
            <g key={tk.v}>
              <line
                x1={model.x0}
                x2={model.x0 + model.plotW}
                y1={tk.y + 0.5}
                y2={tk.y + 0.5}
                stroke="var(--border-strong)"
                strokeDasharray="1 4"
                strokeLinecap="round"
              />
              <circle cx={model.x0 - 6} cy={tk.y} r={1.25} fill="var(--muted-foreground)" />
              <text
                x={model.x0 - 11}
                y={tk.y}
                dy="0.32em"
                textAnchor="end"
                className="fill-muted-foreground font-mono text-[10px]"
              >
                {fmtAxisMs(tk.v)}
              </text>
            </g>
          ))}

          {cells}

          {model.xTicks.map((tk, i) => (
            <g key={i}>
              <circle cx={tk.x} cy={model.y0 + model.plotH + 6} r={1.25} fill="var(--muted-foreground)" />
              <text
                x={tk.x}
                y={height - 3}
                textAnchor={i === 0 ? 'start' : i === model.xTicks.length - 1 ? 'end' : 'middle'}
                className="fill-muted-foreground font-mono text-[10px]"
              >
                {tk.label}
              </text>
            </g>
          ))}

          {hb && (
            <g pointerEvents="none">
              <line
                x1={hx}
                x2={hx}
                y1={model.y0}
                y2={model.y0 + model.plotH}
                stroke="var(--foreground)"
                strokeOpacity={0.55}
                strokeDasharray="1 3"
                strokeLinecap="round"
              />
              <circle cx={hx} cy={Math.max(model.y0 + 3, hy)} r={3.5} fill="var(--foreground)" stroke="var(--card)" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
      {hb && model && (
        <div
          className="bg-popover text-popover-foreground shadow-pop pointer-events-none absolute top-0 z-10 rounded-lg border px-3 py-2 text-xs"
          style={hx > width / 2 ? { right: width - hx + 12 } : { left: hx + 12 }}
        >
          <div className="text-muted-foreground num">{formatDateTime(hb.t0)}</div>
          <div className="mt-1 flex items-center gap-2 font-medium">
            <span className={cn('size-2 rounded-[2px]', hb.down ? 'bg-down' : hb.pending ? 'bg-pending' : 'bg-cell-ink')} />
            <span className="num">{hb.avg === null ? '—' : formatLatency(hb.avg)}</span>
          </div>
          {hb.down > 0 && <div className="text-down mt-0.5">{t('status.down')} × {hb.down}</div>}
        </div>
      )}
    </div>
  )
}
