import type { Key } from '@/i18n'
import type { FormState } from '@/pages/monitor-form'

export interface MonitorTemplate {
  id: string
  name: Key
  desc: Key
  /** Fields to set. */
  patch: Partial<FormState>
  /** URL path to append when the URL has no path yet (HTTP templates). */
  path?: string
}

const http = (patch: Partial<FormState> = {}): Partial<FormState> => ({
  type: 'http',
  method: 'GET',
  interval: '60',
  retry_interval: '60',
  max_retries: '2',
  timeout: '30',
  accepted_status: '200-299',
  max_redirects: '10',
  ...patch,
})
const tcp = (port: number): Partial<FormState> => ({ type: 'tcp', port: String(port), interval: '60', timeout: '10' })

/** Data-driven list of templates (names/descriptions come from i18n). */
export const TEMPLATES: MonitorTemplate[] = [
  { id: 'laravel', name: 'tpl.laravel', desc: 'tpl.laravelD', path: '/up', patch: http({ accepted_status: '200' }) },
  { id: 'wordpress', name: 'tpl.wordpress', desc: 'tpl.wordpressD', path: '/wp-login.php', patch: http() },
  { id: 'static', name: 'tpl.static', desc: 'tpl.staticD', patch: http({ max_redirects: '10' }) },
  { id: 'jsonapi', name: 'tpl.jsonapi', desc: 'tpl.jsonapiD', patch: http({ headers: '{"Accept": "application/json"}' }) },
  { id: 'keyword', name: 'tpl.keyword', desc: 'tpl.keywordD', patch: http({ type: 'keyword' }) },
  { id: 'ssh', name: 'tpl.ssh', desc: 'tpl.sshD', patch: tcp(22) },
  { id: 'smtp', name: 'tpl.smtp', desc: 'tpl.smtpD', patch: tcp(587) },
  { id: 'https', name: 'tpl.https', desc: 'tpl.httpsD', patch: tcp(443) },
  { id: 'mysql', name: 'tpl.mysql', desc: 'tpl.mysqlD', patch: tcp(3306) },
  { id: 'postgres', name: 'tpl.postgres', desc: 'tpl.postgresD', patch: tcp(5432) },
  { id: 'redis', name: 'tpl.redis', desc: 'tpl.redisD', patch: tcp(6379) },
]

const typed = (url: string) => url.trim() !== '' && url.trim() !== 'https://' && url.trim() !== 'http://'

/** Appends `path` to `url` when the URL has no path yet. Returns the original URL when not applicable. */
export function applyPath(url: string, path: string): string {
  try {
    const u = new URL(url.trim())
    if (u.pathname === '/' || u.pathname === '') {
      u.pathname = path
      return u.toString()
    }
  } catch {
    /* not a valid URL yet */
  }
  return url
}

/** Computes the form after applying a template, keeping any host the user already typed. */
export function applyTemplate(form: FormState, tpl: MonitorTemplate): { form: FormState; pendingPath: string | null } {
  const next: FormState = { ...form, ...tpl.patch }
  let pendingPath: string | null = null
  if (next.type === 'tcp') {
    // Keep the typed host: reuse a hostname, or take it from an already typed URL.
    if (!next.hostname.trim() && typed(form.url)) {
      try {
        next.hostname = new URL(form.url.trim()).hostname
      } catch {
        /* ignore */
      }
    }
  } else {
    if (form.type === 'tcp' && form.hostname.trim() && !typed(form.url)) next.url = `https://${form.hostname.trim()}`
    if (tpl.path) {
      if (typed(next.url)) next.url = applyPath(next.url, tpl.path)
      if (!typed(next.url) || !next.url.includes(tpl.path)) pendingPath = typed(next.url) ? null : tpl.path
    }
  }
  return { form: next, pendingPath }
}

