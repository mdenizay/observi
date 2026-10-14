import { translate, translateDynamic } from '@/i18n'
import type { Brand } from './brand'
import type {
  Beat,
  Group,
  ManagedUser,
  Monitor,
  MonitorEvent,
  MonitorInput,
  MonitorStats,
  MonitorSummary,
  Notification,
  NotificationInput,
  Role,
  Activity,
  DomainItem,
  ReportSettings,
  ReportSummary,
  AuditEntry,
  MaintenanceInput,
  MaintenanceWindow,
  TagCount,
  BulkAction,
  ReleasesResponse,
  UpdateInfo,
  User,
  LoginResult,
  SessionItem,
  PasskeyItem,
  TokenItem,
  SecuritySummary,
} from './types'
import type { PublicKeyJSON } from './webauthn'

export class ApiError extends Error {
  status: number
  /** Stable machine-readable error code from the backend (e.g. `invalid_credentials`). */
  code: string | null
  constructor(status: number, message: string, code: string | null = null) {
    super(message)
    this.status = status
    this.code = code
  }
}

type UnauthorizedHandler = () => void
let onUnauthorized: UnauthorizedHandler | null = null
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null) {
  onUnauthorized = fn
}

interface RequestOpts {
  /** Do not trigger global 401 redirect (login, me). */
  silent401?: boolean
  /** Treat a 2xx body with `{error}` as a failure (POST /notifications/test). */
  errorInBody?: boolean
}

async function request<T>(method: string, path: string, body?: unknown, opts: RequestOpts = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers:
        body instanceof Blob
          ? { 'Content-Type': body.type || 'application/octet-stream' }
          : body !== undefined
            ? { 'Content-Type': 'application/json' }
            : undefined,
      body: body instanceof Blob ? body : body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the server', 'network')
  }

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!res.ok) {
    if (res.status === 401 && !opts.silent401) onUnauthorized?.()
    const err = extractError(data)
    if (err) throw new ApiError(res.status, err.message, err.code ?? statusCode(res.status))
    throw new ApiError(res.status, `Request failed (${res.status})`, statusCode(res.status) ?? 'request_failed')
  }
  // POST /notifications/test may return 200 with {error, code}
  const bodyErr = opts.errorInBody ? extractError(data) : null
  if (bodyErr) throw new ApiError(res.status, bodyErr.message, bodyErr.code)
  return data as T
}

function extractError(data: unknown): { message: string; code: string | null } | null {
  if (data && typeof data === 'object' && 'error' in data) {
    const d = data as { error: unknown; code?: unknown }
    if (typeof d.error === 'string' && d.error)
      return { message: d.error, code: typeof d.code === 'string' && d.code ? d.code : null }
  }
  return null
}

function statusCode(status: number): string | null {
  return status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 404 ? 'not_found' : null
}

const get = <T>(p: string, o?: RequestOpts) => request<T>('GET', p, undefined, o)
const post = <T>(p: string, b?: unknown, o?: RequestOpts) => request<T>('POST', p, b ?? {}, o)
const put = <T>(p: string, b: unknown) => request<T>('PUT', p, b)
const del = <T>(p: string) => request<T>('DELETE', p)

export const api = {
  login: (username: string, password: string) =>
    post<LoginResult>('/auth/login', { username, password }, { silent401: true }),
  login2fa: (challenge: string, code: string) => post<User>('/auth/login/2fa', { challenge, code }, { silent401: true }),
  passkeyLoginOptions: (username?: string) =>
    post<{ challenge_id: string; publicKey: PublicKeyJSON }>('/auth/passkey/options', username ? { username } : {}, { silent401: true }),
  passkeyLogin: (challenge_id: string, credential: unknown) =>
    post<User>('/auth/passkey/login', { challenge_id, credential }, { silent401: true }),
  resetCheck: (token: string) =>
    get<{ valid: boolean; name: string }>(`/auth/reset/${encodeURIComponent(token)}`, { silent401: true }),
  resetPassword: (token: string, password: string) => post('/auth/reset', { token, password }, { silent401: true }),

  security: () => get<SecuritySummary>('/auth/security'),
  sessions: () => get<{ items: SessionItem[] }>('/auth/sessions'),
  revokeSession: (id: string) => del(`/auth/sessions/${encodeURIComponent(id)}`),
  revokeOtherSessions: () => post<{ revoked: number }>('/auth/sessions/revoke-others'),
  twoFaSetup: () => post<{ secret: string; otpauth_url: string; qr_svg: string }>('/auth/2fa/setup'),
  twoFaEnable: (code: string) => post<{ recovery_codes: string[] }>('/auth/2fa/enable', { code }),
  twoFaDisable: (password: string, code: string) => post('/auth/2fa/disable', { password, code }),
  twoFaRecoveryCodes: (password: string, code: string) =>
    post<{ recovery_codes: string[] }>('/auth/2fa/recovery-codes', { password, code }),
  passkeys: () => get<{ items: PasskeyItem[] }>('/auth/passkeys'),
  deletePasskey: (id: string) => del(`/auth/passkeys/${encodeURIComponent(id)}`),
  passkeyRegisterOptions: () => post<{ challenge_id: string; publicKey: PublicKeyJSON }>('/auth/passkeys/options'),
  passkeyRegister: (challenge_id: string, name: string | undefined, credential: unknown) =>
    post('/auth/passkeys/register', { challenge_id, ...(name ? { name } : {}), credential }),
  tokens: () => get<{ items: TokenItem[] }>('/tokens'),
  createToken: (b: { name: string; scope: 'read' | 'write'; expires_days?: number }) =>
    post<{ token: string; item: TokenItem }>('/tokens', b),
  deleteToken: (id: number) => del(`/tokens/${id}`),
  userResetLink: (id: number, hours: number) =>
    post<{ token: string; path: string; expires_at: number; username: string }>(`/users/${id}/reset-link`, { hours }),
  userRevokeSessions: (id: number) => post<{ revoked?: number }>(`/users/${id}/sessions/revoke`),
  userSecurityReset: (id: number) => post(`/users/${id}/security/reset`),
  logout: () => post<Record<string, never>>('/auth/logout'),
  me: () => get<User>('/auth/me', { silent401: true }),
  changePassword: (current: string, next: string) => post('/auth/password', { current, new: next }),

  monitors: () => get<MonitorSummary[]>('/monitors'),
  monitor: (id: number) => get<Monitor>(`/monitors/${id}`),
  createMonitor: (m: MonitorInput) => post<Monitor>('/monitors', m),
  updateMonitor: (id: number, m: MonitorInput) => put<Monitor>(`/monitors/${id}`, m),
  bulkMonitors: (body: {
    ids: number[]
    action: BulkAction
    group_id?: number | null
    notification_id?: number
    duration_min?: number
    tag?: string
  }) => post<{ affected: number }>('/monitors/bulk', body),
  domains: () => get<{ items: DomainItem[] }>('/domains'),
  domainsCheck: () => post<{ items: DomainItem[] }>('/domains/check'),
  reportSummary: (days: number) => get<ReportSummary>(`/reports/summary?days=${days}`),
  reportSettings: () => get<ReportSettings>('/reports/settings'),
  saveReportSettings: (s: ReportSettings) => put<ReportSettings>('/reports/settings', s),
  sendReport: (period: 'weekly' | 'monthly') => post<{ sent: number }>('/reports/send', { period }),
  maintenanceList: () => get<{ items: MaintenanceWindow[] }>('/maintenance'),
  maintenanceCreate: (w: MaintenanceInput) => post<MaintenanceWindow>('/maintenance', w),
  maintenanceUpdate: (id: number, w: MaintenanceInput) => put<MaintenanceWindow>(`/maintenance/${id}`, w),
  maintenanceDelete: (id: number) => del(`/maintenance/${id}`),
  maintenanceEnd: (id: number) => post<MaintenanceWindow>(`/maintenance/${id}/end`),
  tags: () => get<{ items: TagCount[] }>('/tags'),
  audit: (p: { limit?: number; before?: number | null; action?: string; user?: string }) => {
    const q = new URLSearchParams()
    q.set('limit', String(p.limit ?? 50))
    if (p.before) q.set('before', String(p.before))
    if (p.action) q.set('action', p.action)
    if (p.user) q.set('user', p.user)
    return get<{ items: AuditEntry[]; next_before: number | null }>(`/audit?${q}`)
  },
  activity: (limit = 30) => get<{ items: Activity[] }>(`/activity?limit=${limit}`),
  deleteMonitor: (id: number) => del(`/monitors/${id}`),
  pauseMonitor: (id: number) => post(`/monitors/${id}/pause`),
  resumeMonitor: (id: number) => post(`/monitors/${id}/resume`),
  stats: (id: number) => get<MonitorStats>(`/monitors/${id}/stats`),
  heartbeats: (id: number, hours: number) => get<Beat[]>(`/monitors/${id}/heartbeats?hours=${hours}`),
  events: (id: number, limit = 50) => get<MonitorEvent[]>(`/monitors/${id}/events?limit=${limit}`),

  users: () => get<ManagedUser[]>('/users'),
  createUser: (u: {
    username: string
    name: string
    password: string
    role: Role
    monitor_ids: number[]
    group_ids: number[]
  }) => post('/users', u),
  updateUser: (
    id: number,
    u: { name?: string; role?: Role; password?: string; monitor_ids?: number[]; group_ids?: number[] },
  ) => put(`/users/${id}`, u),
  deleteUser: (id: number) => del(`/users/${id}`),

  branding: () => get<Brand>('/branding', { silent401: true }),
  updateBrandName: (name: string) => put<Brand>('/branding', { name }),
  uploadLogo: (file: Blob) => put<Brand>('/branding/logo', file),
  deleteLogo: () => del<Brand>('/branding/logo'),

  version: () => get<{ version: string }>('/version', { silent401: true }),
  updateProfile: (name: string) => put<User>('/auth/profile', { name }),
  releases: (refresh = false) => get<ReleasesResponse>(`/update/releases${refresh ? '?refresh=1' : ''}`),
  updateInfo: () => get<UpdateInfo>('/update'),
  updateCheck: () => post<UpdateInfo>('/update/check'),
  updateApply: () => post<UpdateInfo>('/update/apply'),
  updateSettings: (auto_update: boolean) => put<UpdateInfo>('/update/settings', { auto_update }),

  groups: () => get<Group[]>('/groups'),
  createGroup: (g: { name: string; monitor_ids?: number[] }) => post<{ id: number }>('/groups', g),
  updateGroup: (id: number, g: { name?: string; monitor_ids?: number[] }) => put(`/groups/${id}`, g),
  deleteGroup: (id: number) => del(`/groups/${id}`),

  notifications: () => get<Notification[]>('/notifications'),
  createNotification: (n: NotificationInput) => post<Notification>('/notifications', n),
  updateNotification: (id: number, n: NotificationInput) => put<Notification>(`/notifications/${id}`, n),
  deleteNotification: (id: number) => del(`/notifications/${id}`),
  testNotification: (n: NotificationInput) => post('/notifications/test', n, { errorInBody: true }),
}

/**
 * Localized, user-facing message for any error. API errors are mapped by their
 * `code` (i18n key `errors.<code>`); unknown codes fall back to the server's text.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code && e.code !== 'notification_failed') {
      const localized = translateDynamic(`errors.${e.code}`, { status: e.status })
      if (localized) return localized
    }
    return e.message
  }
  if (e instanceof Error && e.message) return e.message
  return translate('errors.unexpected')
}
