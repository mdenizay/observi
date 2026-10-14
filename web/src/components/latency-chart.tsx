import { useId, useMemo, useState } from 'react'
import { useWidth } from '@/hooks/use-width'
import { translateMessage } from '@/lib/messages'
import { beatLabel, formatDateTime, formatDay, formatLatency, formatTime } from '@/lib/format'
import type { Beat } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'

interface Props {
  beats: Beat[]
  hours: number
  height?: number
  className?: string
}

const PAD = { top: 12, right: 12, bottom: 22, left: 44 }

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
  const { t, lang } = useI18n()
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const gid = useId().replace(/:/g, '')

  const model = useMemo(() => {
    if (width <= 0 || beats.length === 0) return null
    const w = width
    const h = height
    const iw = Math.max(1, w - PAD.left - PAD.right)
    const ih = Math.max(1, h - PAD.top - PAD.bottom)

    const t0 = beats[0].t
    const t1 = Math.max(beats[beats.length - 1].t, t0 + 1)
    const lat = beats.map((b) => b.l).filter((l): l is number => l !== null && l !== undefined)
    const yMax = niceMax(lat.length ? Math.max(...lat) * 1.1 : 100)

    const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0)) * iw
    const y = (l: number) => PAD.top + ih - (l / yMax) * ih

    // Break the line wherever latency is missing (down / paused).
    const segments: { x: number; y: number }[][] = []
    let cur: { x: number; y: number }[] = []
    for (const b of beats) {
      if (b.l === null || b.l === undefined || b.s === 0 || b.s === 3) {
        if (cur.length) segments.push(cur)
        cur = []
        continue
      }
      cur.push({ x: x(b.t), y: y(b.l) })
    }
    if (cur.length) segments.push(cur)

    const base = PAD.top + ih
    const line = segments
      .map((seg) => seg.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(''))
      .join('')
    const area = segments
      .map((seg) => {
        if (seg.length === 1) {
          const p = seg[0]
          return `M${p.x - 1},${base}L${p.x - 1},${p.y}L${p.x + 1},${p.y}L${p.x + 1},${base}Z`
        }
        const d = seg.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('')
        return `${d}L${seg[seg.length - 1].x.toFixed(1)},${base}L${seg[0].x.toFixed(1)},${base}Z`
      })
      .join('')

    // Down markers: contiguous runs of down beats drawn as red bands.
    const bands: { x: number; w: number }[] = []
    const step = beats.length > 1 ? iw / (beats.length - 1) : 4
    for (let i = 0; i < beats.length; i++) {
      if (beats[i].s !== 0) continue
      let j = i
      while (j + 1 < beats.length && beats[j + 1].s === 0) j++
      const xa = x(beats[i].t)
      const xb = x(beats[j].t)
      bands.push({ x: xa - step / 2, w: Math.max(2, xb - xa + step) })
      i = j
    }

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: yMax * f, y: y(yMax * f) }))
    const nX = Math.max(2, Math.min(6, Math.floor(iw / 90)))
    const span = t1 - t0
    const showDay = hours > 24 || span > 24 * 3600_000
    const xTicks = Array.from({ length: nX }, (_, i) => {
      const t = t0 + (span * i) / (nX - 1)
      return { x: x(t), label: showDay ? `${formatDay(t)}${hours <= 168 ? ` ${formatTime(t)}` : ''}` : formatTime(t) }
    })

    return { w, h, iw, ih, x, y, line, area, bands, yTicks, xTicks, base }
  }, [beats, width, height, hours, lang])

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!model) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    // binary search nearest by x
    let lo = 0
    let hi = beats.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (model.x(beats[mid].t) < px) lo = mid
      else hi = mid
    }
    const best = Math.abs(model.x(beats[lo].t) - px) <= Math.abs(model.x(beats[hi].t) - px) ? lo : hi
    setHover(best)
  }

  const hb = hover !== null ? beats[hover] : null
  const hx = hb && model ? model.x(hb.t) : 0
  const hy = hb && model && hb.l !== null && hb.l !== undefined ? model.y(hb.l) : null

  return (
    <div ref={ref} className={cn('relative w-full select-none', className)} style={{ height }}>
      {beats.length === 0 && (
        <div className="text-muted-foreground absolute inset-0 flex items-center justify-center text-sm">
          {t('chart.noData')}
        </div>
      )}
      {model && (
        <svg
          width={model.w}
          height={model.h}
          className="block touch-none"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={`g${gid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--chart)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--chart)" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {model.yTicks.map((t) => (
            <g key={t.v}>
              <line
                x1={PAD.left}
                x2={model.w - PAD.right}
                y1={t.y}
                y2={t.y}
                className="stroke-border"
                strokeDasharray={t.v === 0 ? undefined : '3 3'}
              />
              <text
                x={PAD.left - 8}
                y={t.y}
                dy="0.32em"
                textAnchor="end"
                className="fill-muted-foreground text-[10px] tabular-nums"
              >
                {fmtAxisMs(t.v)}
              </text>
            </g>
          ))}
          <text x={4} y={PAD.top - 2} className="fill-muted-foreground text-[10px]">
            ms
          </text>

          {model.xTicks.map((t, i) => (
            <text
              key={i}
              x={t.x}
              y={model.h - 6}
              textAnchor={i === 0 ? 'start' : i === model.xTicks.length - 1 ? 'end' : 'middle'}
              className="fill-muted-foreground text-[10px] tabular-nums"
            >
              {t.label}
            </text>
          ))}

          {model.bands.map((b, i) => (
            <rect
              key={i}
              x={b.x}
              y={PAD.top}
              width={b.w}
              height={model.ih}
              className="fill-down"
              fillOpacity={0.15}
            />
          ))}

          <path d={model.area} fill={`url(#g${gid})`} />
          <path
            d={model.line}
            fill="none"
            stroke="var(--chart)"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {hb && (
            <g pointerEvents="none">
              <line x1={hx} x2={hx} y1={PAD.top} y2={model.base} className="stroke-muted-foreground/60" />
              {hy !== null && (
                <circle cx={hx} cy={hy} r={3.5} fill="var(--chart)" className="stroke-background" strokeWidth={2} />
              )}
            </g>
          )}
        </svg>
      )}
      {hb && model && (
        <div
          className="bg-popover text-popover-foreground pointer-events-none absolute top-1 z-10 rounded-md border px-2.5 py-1.5 text-xs shadow-md"
          style={
            hx > model.w / 2
              ? { right: model.w - hx + 10 }
              : { left: hx + 10 }
          }
        >
          <div className="text-muted-foreground">{formatDateTime(hb.t)}</div>
          <div className="mt-0.5 flex items-center gap-2 font-medium">
            <span
              className={cn(
                'size-2 rounded-full',
                hb.s === 1 ? 'bg-up' : hb.s === 0 ? 'bg-down' : hb.s === 2 ? 'bg-pending' : hb.s === 4 ? 'bg-maint' : 'bg-paused',
              )}
            />
            {beatLabel(hb.s)}
            <span className="tabular-nums">{formatLatency(hb.l)}</span>
          </div>
          {hb.m && (
            <div className="text-muted-foreground mt-0.5 max-w-56 truncate">{translateMessage(hb.m, lang)}</div>
          )}
        </div>
      )}
    </div>
  )
}
