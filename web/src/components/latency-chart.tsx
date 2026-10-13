import { useId, useMemo, useState } from 'react'
import { useWidth } from '@/hooks/use-width'
import { useI18n } from '@/i18n'
import { formatDateTime, formatDay, formatLatency, formatTime } from '@/lib/format'
import type { Beat } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * Smooth response-time area chart: monotone curve with a vertical gradient fill,
 * dashed gridlines, soft red bands for down periods and a crosshair tooltip.
 */

interface Props {
  beats: Beat[]
  hours: number
  height?: number
  className?: string
}

const PAD = { top: 14, right: 14, bottom: 30, left: 56 }

interface Pt {
  any: number
  t: number
  x: number
  y: number | null
  v: number | null
  down: number
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
  return `${Math.round(v)} ms`
}

/** Monotone cubic (Fritsch–Carlson) path through points, no overshoot. */
function monotone(pts: { x: number; y: number }[]): string {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M${pts[0].x},${pts[0].y}`
  const dx: number[] = []
  const m: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x || 1e-6)
    m.push((pts[i + 1].y - pts[i].y) / dx[i])
  }
  const tg: number[] = [m[0]]
  for (let i = 1; i < n - 1; i++) tg.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2)
  tg.push(m[n - 2])
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      tg[i] = 0
      tg[i + 1] = 0
      continue
    }
    const a = tg[i] / m[i]
    const b = tg[i + 1] / m[i]
    const s = a * a + b * b
    if (s > 9) {
      const k = 3 / Math.sqrt(s)
      tg[i] = k * a * m[i]
      tg[i + 1] = k * b * m[i]
    }
  }
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    d += `C${(pts[i].x + h).toFixed(1)},${(pts[i].y + tg[i] * h).toFixed(1)} ${(pts[i + 1].x - h).toFixed(1)},${(
      pts[i + 1].y -
      tg[i + 1] * h
    ).toFixed(1)} ${pts[i + 1].x.toFixed(1)},${pts[i + 1].y.toFixed(1)}`
  }
  return d
}

export function LatencyChart({ beats, hours, height = 220, className }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const { t, lang } = useI18n()
  const gid = `g${useId().replace(/:/g, '')}`

  const model = useMemo(() => {
    if (width <= 0 || beats.length === 0) return null
    const iw = Math.max(1, width - PAD.left - PAD.right)
    const ih = Math.max(1, height - PAD.top - PAD.bottom)
    const base = PAD.top + ih

    // Bucket for a smooth line (≈ one point every 5px).
    const t0 = beats[0].t
    const t1 = Math.max(beats[beats.length - 1].t, t0 + 1)
    const n = Math.max(2, Math.min(beats.length, Math.floor(iw / 5)))
    const span = (t1 - t0) / n
    const acc = Array.from({ length: n }, () => ({ sum: 0, cnt: 0, down: 0, any: 0 }))
    for (const b of beats) {
      const i = Math.min(n - 1, Math.floor((b.t - t0) / span))
      acc[i].any++
      if (b.s === 0) acc[i].down++
      else if (b.l != null) {
        acc[i].sum += b.l
        acc[i].cnt++
      }
    }
    const vals = acc.map((a) => (a.cnt ? a.sum / a.cnt : null))
    const yMax = niceMax(Math.max(0, ...vals.map((v) => v ?? 0)) * 1.15 || 100)
    const x = (i: number) => PAD.left + (n === 1 ? iw / 2 : (i / (n - 1)) * iw)
    const y = (v: number) => PAD.top + ih - (v / yMax) * ih

    // Empty buckets (no checks at all) are skipped so the line stays continuous;
    // only buckets with failed checks and no latency break it.
    const pts: Pt[] = acc
      .map((a, i) => ({
        t: t0 + (i + 0.5) * span,
        x: x(i),
        v: vals[i],
        y: vals[i] === null ? null : y(vals[i]!),
        down: a.down,
        any: a.any,
      }))
      .filter((p) => p.any > 0)

    // Split into continuous segments (gaps where there's no latency).
    const segs: { x: number; y: number }[][] = []
    let cur: { x: number; y: number }[] = []
    for (const p of pts) {
      if (p.y === null) {
        if (cur.length) segs.push(cur)
        cur = []
      } else cur.push({ x: p.x, y: p.y })
    }
    if (cur.length) segs.push(cur)
    const line = segs.map(monotone).join('')
    const area = segs
      .map((s) => `${monotone(s)}L${s[s.length - 1].x.toFixed(1)},${base}L${s[0].x.toFixed(1)},${base}Z`)
      .join('')

    // Soft red bands over buckets with failed checks.
    const step = n > 1 ? iw / (n - 1) : iw
    const bands: { x: number; w: number }[] = []
    const np = pts.length
    for (let i = 0; i < np; i++) {
      if (!pts[i].down) continue
      let j = i
      while (j + 1 < np && pts[j + 1].down) j++
      const xa = Math.max(PAD.left, pts[i].x - step / 2)
      const xb = Math.min(PAD.left + iw, pts[j].x + step / 2)
      bands.push({ x: xa, w: Math.max(3, xb - xa) })
      i = j
    }

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: yMax * f, y: y(yMax * f) }))
    const nX = Math.max(2, Math.min(6, Math.floor(iw / 110)))
    const showDay = hours > 24
    const fmtX = (tt: number) => (showDay ? `${formatDay(tt)}${hours <= 168 ? ` ${formatTime(tt)}` : ''}` : formatTime(tt))
    const xTicks = Array.from({ length: nX }, (_, i) => {
      const idx = Math.round(((np - 1) * i) / (nX - 1))
      return { x: pts[idx].x, label: fmtX(pts[idx].t) }
    })
    return { iw, ih, base, pts, line, area, bands, yTicks, xTicks, fmtX }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beats, width, height, hours, lang])

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!model) return
    const r = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - r.left
    let best = 0
    let bd = Infinity
    model.pts.forEach((p, i) => {
      const d = Math.abs(p.x - px)
      if (d < bd) {
        bd = d
        best = i
      }
    })
    setHover(best)
  }

  const hp = hover !== null && model ? model.pts[hover] : null
  const pillLabel = hp && model ? model.fmtX(hp.t) : ''
  const pillW = pillLabel.length * 6.4 + 16

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
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--chart)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--chart)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {model.bands.map((b, i) => (
            <rect key={i} x={b.x} y={PAD.top} width={b.w} height={model.ih} rx={4} fill="var(--down)" fillOpacity={0.12} />
          ))}

          {model.yTicks.map((tk) => (
            <g key={tk.v}>
              <line
                x1={PAD.left}
                x2={PAD.left + model.iw}
                y1={tk.y}
                y2={tk.y}
                stroke="var(--border-strong)"
                strokeDasharray={tk.v === 0 ? undefined : '3 5'}
              />
              <text x={PAD.left - 10} y={tk.y} dy="0.32em" textAnchor="end" className="fill-muted-foreground num text-[11px]">
                {fmtAxisMs(tk.v)}
              </text>
            </g>
          ))}

          <path d={model.area} fill={`url(#${gid})`} />
          <path d={model.line} fill="none" stroke="var(--chart)" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />

          {model.xTicks.map((tk, i) => (
            <text
              key={i}
              x={tk.x}
              y={height - 8}
              textAnchor={i === 0 ? 'start' : i === model.xTicks.length - 1 ? 'end' : 'middle'}
              className={cn('fill-muted-foreground num text-[11px] transition-opacity', hp && 'opacity-40')}
            >
              {tk.label}
            </text>
          ))}

          {hp && (
            <g pointerEvents="none">
              <line x1={hp.x} x2={hp.x} y1={PAD.top} y2={model.base} stroke="var(--foreground)" strokeOpacity={0.25} />
              {hp.y !== null && (
                <circle cx={hp.x} cy={hp.y} r={4.5} fill="var(--chart)" stroke="var(--card)" strokeWidth={2.5} />
              )}
              <g
                transform={`translate(${Math.min(Math.max(hp.x - pillW / 2, PAD.left - 8), width - pillW)}, ${height - 23})`}
              >
                <rect width={pillW} height={20} rx={10} fill="var(--foreground)" />
                <text x={pillW / 2} y={14} textAnchor="middle" className="num text-[11px] font-medium" fill="var(--background)">
                  {pillLabel}
                </text>
              </g>
            </g>
          )}
        </svg>
      )}
      {hp && model && (
        <div
          className="bg-popover text-popover-foreground shadow-pop pointer-events-none absolute top-1 z-10 rounded-xl border px-3 py-2 text-xs whitespace-nowrap"
          style={hp.x > width / 2 ? { right: width - hp.x + 14 } : { left: hp.x + 14 }}
        >
          <div className="text-muted-foreground num">{formatDateTime(hp.t)}</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-muted-foreground">{t('detail.responseTime')}</span>
            <span className="num font-medium">{hp.v === null ? '—' : formatLatency(hp.v)}</span>
          </div>
          {hp.down > 0 && (
            <div className="text-down mt-0.5 flex items-center gap-1.5">
              <span className="bg-down size-1.5 rounded-full" />
              {t('status.down')} × {hp.down}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
