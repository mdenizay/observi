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
  User,
} from './types'

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
  const bodyErr = extractError(data)
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
    post<User>('/auth/login', { username, password }, { silent401: true }),
  logout: () => post<Record<string, never>>('/auth/logout'),
  me: () => get<User>('/auth/me', { silent401: true }),
  changePassword: (current: string, next: string) => post('/auth/password', { current, new: next }),

  monitors: () => get<MonitorSummary[]>('/monitors'),
  monitor: (id: number) => get<Monitor>(`/monitors/${id}`),
  createMonitor: (m: MonitorInput) => post<Monitor>('/monitors', m),
  updateMonitor: (id: number, m: MonitorInput) => put<Monitor>(`/monitors/${id}`, m),
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

  groups: () => get<Group[]>('/groups'),
  createGroup: (g: { name: string; monitor_ids?: number[] }) => post<{ id: number }>('/groups', g),
  updateGroup: (id: number, g: { name?: string; monitor_ids?: number[] }) => put(`/groups/${id}`, g),
  deleteGroup: (id: number) => del(`/groups/${id}`),

  notifications: () => get<Notification[]>('/notifications'),
  createNotification: (n: NotificationInput) => post<Notification>('/notifications', n),
  updateNotification: (id: number, n: NotificationInput) => put<Notification>(`/notifications/${id}`, n),
  deleteNotification: (id: number) => del(`/notifications/${id}`),
  testNotification: (n: NotificationInput) => post('/notifications/test', n),
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
