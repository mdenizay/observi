export type Role = 'superadmin' | 'user'

export interface User {
  id: number
  username: string
  name: string
  role: Role
}

export type BeatStatus = 0 | 1 | 2 | 3
export interface Beat {
  t: number
  s: BeatStatus
  l: number | null
  m?: string | null
}

export type MonitorType = 'http' | 'keyword' | 'tcp'
export type MonitorStatus = 'up' | 'down' | 'pending' | 'paused' | 'unknown'

export interface MonitorSummary {
  id: number
  name: string
  type: MonitorType
  url: string | null
  hostname: string | null
  port: number | null
  interval: number
  active: boolean
  status: MonitorStatus
  latency_ms: number | null
  last_check: number | null
  message: string | null
  uptime_24h: number | null
  cert: CertInfo | null
  /** Reason the last check's TLS validation failed (site still reachable), else null. */
  ssl_problem: string | null
  group_id: number | null
  group_name: string | null
  beats: Beat[]
}

export interface CertInfo {
  /** Expiry time in ms. */
  expires_at: number
  /** Whole days left; negative once expired. */
  days_left: number
  status: 'ok' | 'expiring' | 'expired'
  issuer: string | null
  /** Last probe time in ms. */
  checked_at: number
}

export interface MonitorInput {
  name: string
  type: MonitorType
  url?: string
  method?: string
  keyword?: string
  invert_keyword?: boolean
  hostname?: string
  port?: number
  interval: number
  retry_interval: number
  max_retries: number
  timeout: number
  accepted_status: string
  ignore_tls: boolean
  upside_down: boolean
  max_redirects: number
  headers?: string | null
  body?: string | null
  description?: string | null
  group_id?: number | null
  notification_ids: number[]
}

export type Monitor = Omit<MonitorSummary, 'url' | 'hostname' | 'port' | 'group_id'> &
  MonitorInput & { url: string | null; hostname: string | null; port: number | null; group_id: number | null }

export interface Group {
  id: number
  name: string
  monitor_ids: number[]
}

export interface MonitorStats {
  uptime_24h: number | null
  uptime_7d: number | null
  uptime_30d: number | null
  avg_latency_24h: number | null
}

export interface MonitorEvent {
  t: number
  s: BeatStatus
  m: string | null
}

export interface ManagedUser extends User {
  monitor_ids: number[]
  group_ids: number[]
  created_at: number
}

export type NotificationKind = 'telegram' | 'smtp' | 'webhook'
export interface TelegramCfg {
  bot_token: string
  chat_id: string
}
export interface SmtpCfg {
  host: string
  port: number
  security: 'starttls' | 'tls' | 'none'
  username?: string
  password?: string
  from: string
  to: string
}
export interface WebhookCfg {
  url: string
  format: 'json' | 'discord' | 'slack'
}
export interface NotificationInput {
  name: string
  kind: NotificationKind
  is_default: boolean
  apply_existing?: boolean
  config: TelegramCfg | SmtpCfg | WebhookCfg
}
export type Notification = NotificationInput & { id: number }

export interface BeatEvent {
  monitor_id: number
  t: number
  s: BeatStatus
  l: number | null
  m: string | null
  status: MonitorStatus
}

export interface ReleaseInfo {
  version: string
  name: string
  published_at: number | null
  notes: string | null
  url: string
  is_current: boolean
  is_newer: boolean
}

export interface ReleasesResponse {
  releases: ReleaseInfo[]
  fetched_at: number
}

export interface UpdateInfo {
  current: string
  latest: string | null
  available: boolean
  release_url: string | null
  published_at: number | null
  notes: string | null
  checked_at: number | null
  auto_update: boolean
  mode: 'systemd' | 'docker' | 'manual'
  can_apply: boolean
  state: 'idle' | 'checking' | 'updating' | 'error'
  error: string | null
  last_result: { ok: boolean; version: string; error: string | null; at: number } | null
}
