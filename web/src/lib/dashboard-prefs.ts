export type WidgetId = 'overview' | 'tiles' | 'monitors' | 'expiring' | 'incidents' | 'slowest'
export type HeatRange = '24h' | '7d' | '30d'

export interface WidgetPref {
  id: WidgetId
  visible: boolean
}
export interface DashboardPrefs {
  widgets: WidgetPref[]
  heatmap: { range: HeatRange; grouped: boolean; expanded: boolean }
}

/** Known sections in their default order. The monitors list can be moved but never hidden. */
export const DEFAULT_WIDGETS: WidgetPref[] = [
  { id: 'overview', visible: true },
  { id: 'tiles', visible: true },
  { id: 'monitors', visible: true },
  { id: 'expiring', visible: false },
  { id: 'incidents', visible: false },
  { id: 'slowest', visible: false },
]

export const DEFAULT_PREFS: DashboardPrefs = {
  widgets: DEFAULT_WIDGETS,
  heatmap: { range: '24h', grouped: false, expanded: false },
}

const RANGES: HeatRange[] = ['24h', '7d', '30d']
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Tolerant parser: unknown ids are dropped, new ids are appended with their defaults. */
export function normalizePrefs(raw: unknown): DashboardPrefs {
  if (!isRecord(raw)) return DEFAULT_PREFS
  const known = new Map(DEFAULT_WIDGETS.map((w) => [w.id, w]))
  const seen = new Set<WidgetId>()
  const widgets: WidgetPref[] = []
  if (Array.isArray(raw.widgets)) {
    for (const w of raw.widgets) {
      if (!isRecord(w) || typeof w.id !== 'string') continue
      const def = known.get(w.id as WidgetId)
      if (!def || seen.has(def.id)) continue
      seen.add(def.id)
      widgets.push({ id: def.id, visible: def.id === 'monitors' ? true : typeof w.visible === 'boolean' ? w.visible : def.visible })
    }
  }
  for (const def of DEFAULT_WIDGETS) if (!seen.has(def.id)) widgets.push({ ...def })
  const h = isRecord(raw.heatmap) ? raw.heatmap : {}
  return {
    widgets,
    heatmap: {
      range: RANGES.includes(h.range as HeatRange) ? (h.range as HeatRange) : DEFAULT_PREFS.heatmap.range,
      grouped: typeof h.grouped === 'boolean' ? h.grouped : DEFAULT_PREFS.heatmap.grouped,
      expanded: typeof h.expanded === 'boolean' ? h.expanded : DEFAULT_PREFS.heatmap.expanded,
    },
  }
}

const LS_KEY = 'observi-dashboard-prefs'

export function readLocalPrefs(): DashboardPrefs {
  try {
    const s = localStorage.getItem(LS_KEY)
    return s ? normalizePrefs(JSON.parse(s)) : DEFAULT_PREFS
  } catch {
    return DEFAULT_PREFS
  }
}

export function writeLocalPrefs(p: DashboardPrefs) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p))
  } catch {
    /* storage unavailable */
  }
}
