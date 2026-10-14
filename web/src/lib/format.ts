import { getLang, translate } from '@/i18n'
import type { BeatStatus, MonitorStatus } from './types'

export const statusLabel = (s: MonitorStatus) => translate(`status.${s}` as const)
export const beatLabel = (s: BeatStatus) => translate(`status.${beatToStatus[s]}` as const)

export const beatToStatus: Record<BeatStatus, MonitorStatus> = {
  0: 'down',
  1: 'up',
  2: 'pending',
  3: 'paused',
}

const nfCache = new Map<string, Intl.NumberFormat>()
function nf(digits: number) {
  const key = `${getLang()}:${digits}`
  let f = nfCache.get(key)
  if (!f) {
    f = new Intl.NumberFormat(getLang(), { minimumFractionDigits: digits, maximumFractionDigits: digits })
    nfCache.set(key, f)
  }
  return f
}

/** Locale-aware fixed-decimal number. */
export const formatNumber = (v: number, digits = 0) => nf(digits).format(v)

export function formatUptime(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  if (v >= 100) return '100%'
  return `${formatNumber(v, digits)}%`
}

export function formatLatency(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  if (v >= 1000) return `${formatNumber(v / 1000, 2)} ${translate('unit.second')}`
  return `${formatNumber(Math.round(v))} ms`
}

const dtCache = new Map<string, Intl.DateTimeFormat>()
function dtf(kind: 'full' | 'time' | 'day' | 'date') {
  const lang = getLang()
  const key = `${lang}:${kind}`
  let f = dtCache.get(key)
  if (!f) {
    const opts: Intl.DateTimeFormatOptions =
      kind === 'full'
        ? {
            day: '2-digit',
            month: lang === 'tr' ? '2-digit' : 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }
        : kind === 'time'
          ? { hour: '2-digit', minute: '2-digit' }
          : kind === 'date'
            ? { day: '2-digit', month: lang === 'tr' ? '2-digit' : 'short', year: 'numeric' }
            : { day: '2-digit', month: 'short' }
    f = new Intl.DateTimeFormat(lang, opts)
    dtCache.set(key, f)
  }
  return f
}

export const formatDateTime = (t: number) => dtf('full').format(t)
export const formatTime = (t: number) => dtf('time').format(t)
export const formatDay = (t: number) => dtf('day').format(t)
export const formatDate = (t: number) => dtf('date').format(t)

const rtfCache = new Map<string, Intl.RelativeTimeFormat>()
export function formatRelative(t: number, now = Date.now()): string {
  const lang = getLang()
  let rtf = rtfCache.get(lang)
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
    rtfCache.set(lang, rtf)
  }
  const diff = (t - now) / 1000
  const abs = Math.abs(diff)
  if (abs < 45) return translate('time.justNow')
  if (abs < 3570) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day')
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), 'month')
  return rtf.format(Math.round(diff / (86400 * 365)), 'year')
}

export function uptimeTone(v: number | null | undefined): 'up' | 'pending' | 'down' | 'muted' {
  if (v === null || v === undefined) return 'muted'
  if (v >= 99) return 'up'
  if (v >= 95) return 'pending'
  return 'down'
}

export function monitorTarget(m: { type: string; url: string | null; hostname: string | null; port: number | null }) {
  if (m.type === 'tcp') return m.hostname ? `${m.hostname}${m.port ? `:${m.port}` : ''}` : ''
  return m.url ?? ''
}

/** Compact duration such as "3h 5m" / "3 sa 5 dk". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const u = (n: number, k: 'unit.d' | 'unit.h' | 'unit.m' | 'unit.s') => `${n}${translate(k)}`
  if (d) return h ? `${u(d, 'unit.d')} ${u(h, 'unit.h')}` : u(d, 'unit.d')
  if (h) return m ? `${u(h, 'unit.h')} ${u(m, 'unit.m')}` : u(h, 'unit.h')
  if (m) return m < 10 && sec ? `${u(m, 'unit.m')} ${u(sec, 'unit.s')}` : u(m, 'unit.m')
  return u(sec, 'unit.s')
}
