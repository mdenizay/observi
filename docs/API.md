# Observi API

All endpoints are JSON under `/api`. Auth is a session cookie `observi_session`
(HttpOnly, SameSite=Lax) set by login. Unauthenticated → `401`, forbidden → `403`.
Errors: `{ "error": "English message", "code": "machine_code" }` — clients should localise by `code`
(e.g. `invalid_credentials`, `password_too_short`, `username_taken`, `url_scheme`, `forbidden`, `not_found`). Timestamps are unix **milliseconds**.

Roles: `superadmin` (manages everything) and `user` (read-only, sees only
monitors assigned to them).

Status codes used in heartbeats (`s`): `0` = down, `1` = up, `2` = pending, `3` = paused.
Monitor `status` string: `"up" | "down" | "pending" | "paused" | "unknown"`.

## Auth
- `POST /api/auth/login` `{username, password}` → `User`
- `POST /api/auth/logout` → `{}`
- `GET  /api/auth/me` → `User` (401 if not logged in)
- `POST /api/auth/password` `{current, new}` → `{}`

`User = {id, username, name, role: "superadmin"|"user"}`

## Monitors
- `GET /api/monitors` → `MonitorSummary[]` (user sees only assigned)
- `GET /api/monitors/:id` → `Monitor` (config + summary fields)
- `POST /api/monitors` (superadmin) `MonitorInput` → `Monitor`
- `PUT /api/monitors/:id` (superadmin) `MonitorInput` → `Monitor`
- `DELETE /api/monitors/:id` (superadmin) → `{}`
- `POST /api/monitors/:id/pause` / `POST /api/monitors/:id/resume` (superadmin) → `{}`
- `GET /api/monitors/:id/stats` → `{uptime_24h, uptime_7d, uptime_30d, avg_latency_24h}` (numbers or null; uptime in percent 0–100, latency ms)
- `GET /api/monitors/:id/heartbeats?hours=24` → `Beat[]` oldest→newest (hours 1..720; server downsamples to ≤ 500 points)
- `GET /api/monitors/:id/events?limit=50` → `{t, s, m}[]` status changes, newest first

```ts
type Beat = { t: number; s: 0|1|2|3; l: number|null; m?: string }

type MonitorSummary = {
  id: number; name: string; type: "http"|"keyword"|"tcp";
  url: string|null; hostname: string|null; port: number|null;
  interval: number; active: boolean;
  status: "up"|"down"|"pending"|"paused"|"unknown";
  latency_ms: number|null; last_check: number|null; message: string|null;
  uptime_24h: number|null;
  group_id: number|null; group_name: string|null;
  beats: Beat[];          // last 50, oldest→newest
}

type MonitorInput = {
  name: string; type: "http"|"keyword"|"tcp";
  url?: string; method?: string;            // http/keyword (default GET)
  keyword?: string; invert_keyword?: boolean; // keyword
  hostname?: string; port?: number;         // tcp
  interval: number;        // seconds, min 20
  retry_interval: number;  // seconds
  max_retries: number;     // failures before DOWN (0 = immediately)
  timeout: number;         // seconds
  accepted_status: string; // e.g. "200-299" or "200-299,301"
  ignore_tls: boolean; upside_down: boolean; max_redirects: number;
  headers?: string|null;   // JSON object string
  body?: string|null;
  description?: string|null;
  group_id?: number|null;  // monitor group (one per monitor)
  notification_ids: number[];
}

type Monitor = MonitorSummary & MonitorInput

// HTTPS monitors also carry the TLS certificate state (null for other types / before the first probe):
type Cert = {
  expires_at: number;   // ms
  days_left: number;    // integer, negative once expired
  status: "ok" | "expiring" | "expired";   // expiring = 14 days or less
  issuer: string | null; checked_at: number;
}
// MonitorSummary.cert: Cert | null
```

## Live updates
- `GET /api/events` — Server-Sent Events. Event name `beat`, data
  `{monitor_id, t, s, l, m, status}`. Filtered to monitors the user can see.
  Event `monitors` (no data) means the monitor list changed → refetch.

## Groups (superadmin)
A monitor belongs to at most one group. Granting a user a group gives access to
every monitor in it, including monitors added to the group later.
- `GET /api/groups` → `{id, name, monitor_ids: number[]}[]` (sorted by name)
- `POST /api/groups` `{name, monitor_ids?}` → `{id}` (listed monitors are moved into the group)
- `PUT /api/groups/:id` `{name?, monitor_ids?}` → `{}` (`monitor_ids` replaces membership)
- `DELETE /api/groups/:id` → `{}` (its monitors become ungrouped, not deleted)

## Users (superadmin)
A non-admin user sees `monitor_ids` ∪ all monitors of `group_ids`.
- `GET /api/users` → `{id, username, name, role, monitor_ids: number[], group_ids: number[], created_at}[]`
- `POST /api/users` `{username, name, password, role, monitor_ids, group_ids}`
- `PUT /api/users/:id` `{name?, role?, password?, monitor_ids?, group_ids?}`
- `DELETE /api/users/:id`

## Notifications (superadmin)
- `GET /api/notifications` → `Notification[]`
- `POST /api/notifications` / `PUT /api/notifications/:id` `NotificationInput`
- `DELETE /api/notifications/:id`
- `POST /api/notifications/test` `NotificationInput` → `{}` or `{error}` (sends a test message)

```ts
type NotificationInput = {
  name: string; kind: "telegram"|"smtp"|"webhook";
  is_default: boolean;   // auto-attach to newly created monitors
  apply_existing?: boolean; // on save, attach to all existing monitors
  config: TelegramCfg | SmtpCfg | WebhookCfg;
}
type TelegramCfg = { bot_token: string; chat_id: string }
type SmtpCfg = { host: string; port: number; security: "starttls"|"tls"|"none";
                 username?: string; password?: string; from: string; to: string }
type WebhookCfg = { url: string; format: "json"|"discord"|"slack" }
type Notification = NotificationInput & { id: number }
```

## Branding (white-label)
The product name and logo are configurable. The server also injects them into `index.html`
(`<title>`, favicon and `window.__OBSERVI_BRAND__`) so there is no flash of the default brand.
- `GET /api/branding` (public) → `{name, logo}`; `logo` is a URL (with a `?v=` cache buster) or `null`
- `PUT /api/branding` (superadmin) `{name}` (1–40 chars) → `{name, logo}`
- `GET /api/branding/logo` (public) → the image
- `PUT /api/branding/logo` (superadmin) raw image body with its `Content-Type`
  (png, jpeg, webp, gif or svg+xml; max 512 KB) → `{name, logo}`
- `DELETE /api/branding/logo` (superadmin) → `{name, logo}`

## Updates
- `GET /api/version` (public) → `{version}`
- `GET /api/update` (superadmin) → `{current, latest, available, release_url, published_at, notes, checked_at,
  auto_update, mode: "systemd"|"docker"|"manual", can_apply, state: "idle"|"checking"|"updating"|"error",
  error, last_result: {ok, version, error, at}|null}`
- `POST /api/update/check` (superadmin) — check GitHub now
- `POST /api/update/apply` (superadmin) — install the latest release (systemd installs only;
  errors `update_not_supported`, `no_update`, `update_in_progress`)
- `PUT /api/update/settings` (superadmin) `{auto_update}`

