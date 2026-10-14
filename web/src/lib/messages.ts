import type { Lang } from '@/i18n'

/**
 * Heartbeat / event messages are stored in English by the backend (older rows may
 * already be Turkish). For Turkish we map the known stable formats; anything else
 * is returned untouched.
 */
export function translateMessage(m: string | null | undefined, lang: Lang): string {
  if (!m) return ''
  if (lang !== 'tr') return m
  return trMessage(m)
}

const sslReasonTr: Record<string, string> = {
  'certificate expired': 'sertifikanın süresi dolmuş',
  'untrusted certificate': 'sertifika güvenilir değil',
  'certificate does not match the domain': 'sertifika alan adıyla uyuşmuyor',
  'invalid certificate': 'geçersiz sertifika',
}

function trMessage(m: string): string {
  let r: RegExpExecArray | null
  if (m === 'Timeout') return 'Zaman aşımı'
  if (m === 'Port open') return 'Port açık'
  if (m === 'Paused') return 'Duraklatıldı'
  if (m === 'Hosting account suspended') return 'Hosting hesabı askıya alınmış'
  if ((r = /^SSL certificate problem \(site is reachable\): ([\s\S]*)$/.exec(m)))
    return `SSL sertifikası sorunlu (site erişilebilir): ${sslReasonTr[r[1].trim()] ?? r[1]}`
  if ((r = /^Connection error: ([\s\S]*)$/.exec(m))) return `Bağlantı hatası: ${r[1]}`
  if ((r = /^Too many redirects: ([\s\S]*)$/.exec(m))) return `Çok fazla yönlendirme: ${r[1]}`
  if ((r = /^Client error: ([\s\S]*)$/.exec(m))) return `İstemci hatası: ${r[1]}`
  if ((r = /^Upside-down mode: ([\s\S]*)$/.exec(m))) return `Ters mod: ${trMessage(r[1])}`
  if ((r = /^(.+?), keyword "([\s\S]*)" found$/.exec(m))) return `${r[1]}, "${r[2]}" bulundu`
  if ((r = /^(.+?), keyword "([\s\S]*)" absent$/.exec(m))) return `${r[1]}, "${r[2]}" bulunmadı`
  if ((r = /^Keyword "([\s\S]*)" not found on page$/.exec(m))) return `"${r[1]}" sayfada bulunamadı`
  if ((r = /^Keyword "([\s\S]*)" found on page$/.exec(m))) return `"${r[1]}" sayfada bulundu`
  return m
}
