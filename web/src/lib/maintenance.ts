import type { Key } from '@/i18n'
import { formatDateTime } from './format'
import type { MaintenanceInfo } from './types'

/** Tooltip text for a monitor's active maintenance/mute window. */
export function maintenanceTip(info: MaintenanceInfo, t: (k: Key, p?: Record<string, string | number>) => string) {
  if (info.kind === 'mute')
    return info.until ? t('maint.mutedUntil', { time: formatDateTime(info.until) }) : t('maint.muted')
  return info.until ? t('maint.underUntil', { time: formatDateTime(info.until) }) : t('maint.under')
}
