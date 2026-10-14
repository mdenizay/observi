export type Role = 'superadmin' | 'user'

export interface User {
  id: number
  username: string
  name: string
  role: Role
}

export type BeatStatus = 0 | 1 | 2 | 3 | 4
export interface Beat {
  t: number
  s: BeatStatus
  l: number | null
  m?: string | null
}

export type MonitorType = 'http' | 'keyword' | 'tcp'
export type MonitorStatus = 'up' | 'down' | 'pending' | 'paused' | 'maintenance' | 'unknown'

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
  maintenance: MaintenanceInfo | null
  domain: DomainInfo | null
  tags: string[]
  /** Reason the last check's TLS validation failed (site still reachable), else null. */
  ssl_problem: string | null
  group_id: number | null
  group_name: string | null
  beats: Beat[]
}

export interface DomainInfo {
  /** Registrable domain, e.g. "example.com.tr". */
  name: string
  expires_at: number | null
  days_left: number | null
  status: 'ok' | 'expiring' | 'expired' | 'unknown'
  registrar: string | null
  checked_at: number
  error: string | null
}

export interface DomainItem extends Omit<DomainInfo, 'name'> {
  name: string
  monitor_ids: number[]
}

export interface ReportMonitorRow {
  id: number
  name: string
  group_name: string | null
  uptime: number | null
  incidents: number
  downtime_ms: number
  avg_latency: number | null
}

export interface ReportSummary {
  from: number
  to: number
  uptime: number | null
  incidents: number
  downtime_ms: number
  avg_latency: number | null
  monitors: ReportMonitorRow[]
}

export interface ReportSettings {
  weekly: { enabled: boolean; day: number }
  monthly: { enabled: boolean; day: number }
  hour: number
  tz_offset_min: number
}

export interface MaintenanceInfo {
  id: number
  kind: 'maintenance' | 'mute'
  name: string
  /** End of the current window (ms); null = recurring/unknown. */
  until: number | null
}

export interface MaintenanceRecur {
  /** 0 = Sunday … 6 = Saturday. */
  days: number[]
  /** Minutes after local midnight. */
  start_min: number
  duration_min: number
  tz_offset_min: number
}

export interface MaintenanceWindow {
  id: number
  name: string
  kind: 'maintenance' | 'mute'
  start_at: number | null
  end_at: number | null
  recur: MaintenanceRecur | null
  all: boolean
  monitor_ids: number[]
  group_ids: number[]
  active: boolean
  next_start: number | null
  created_by: string | null
}

export interface MaintenanceInput {
  name: string
  kind?: 'maintenance' | 'mute'
  start_at?: number | null
  end_at?: number | null
  recur?: MaintenanceRecur | null
  all?: boolean
  monitor_ids?: number[]
  group_ids?: number[]
}

export interface TagCount {
  name: string
  count: number
}

export interface AuditEntry {
  id: number
  t: number
  user_id: number | null
  username: string | null
  action: string
  target_type: string | null
  target_id: number | null
  target_name: string | null
  ip: string | null
  details: Record<string, unknown> | null
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
  tags?: string[]
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
  email?: string | null
  two_factor?: boolean
  passkeys?: number
  last_seen_at?: number | null
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
  /** Include this channel in scheduled uptime reports (default true). */
  digest?: boolean
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

export type ActivityKind =
  | 'down'
  | 'up'
  | 'ssl_expiring'
  | 'ssl_expired'
  | 'ssl_renewed'
  | 'domain_expiring'
  | 'domain_expired'
  | 'domain_renewed'

export interface Activity {
  id: number
  t: number
  kind: ActivityKind
  monitor_id: number
  monitor_name: string
  data: { message?: string; down_for_ms?: number; expires_at?: number; days_left?: number; domain?: string } | null
}

export type BulkAction =
  | 'move'
  | 'pause'
  | 'resume'
  | 'delete'
  | 'notify_add'
  | 'notify_remove'
  | 'maintenance'
  | 'mute'
  | 'end_maintenance'
  | 'tag_add'
  | 'tag_remove'

export type LoginResult = User | { needs_2fa: true; challenge: string; username: string }

export interface SessionItem {
  id: string
  current: boolean
  created_at: number
  last_seen_at: number
  ip: string | null
  device: string | null
  method: string | null
}
export interface PasskeyItem {
  id: string
  name: string
  created_at: number
  last_used_at: number | null
}
export interface TokenItem {
  id: number
  name: string
  prefix: string
  scope: 'read' | 'write'
  created_at: number
  last_used_at: number | null
  expires_at: number | null
}
export interface SecuritySummary {
  two_factor: { enabled: boolean; recovery_remaining: number }
  passkeys: number
  tokens: number
  sessions: number
}

export interface HeatmapItem {
  id: number
  name: string
  group_name: string | null
  uptime: number | null
  /** One char per bucket, oldest first: u up, w partly down, d down, m maintenance, p pending, x paused, - no data. */
  cells: string
}
export interface HeatmapData {
  range: '24h' | '7d' | '30d'
  from: number
  to: number
  bucket_ms: number
  buckets: number
  items: HeatmapItem[]
}

export interface EmailResult {
  emailed?: boolean
  email_error?: string
}
