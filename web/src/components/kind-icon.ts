import { Mail, Send, Webhook } from 'lucide-react'
import { translate } from '@/i18n'
import type { NotificationKind } from '@/lib/types'

export const kindIcon: Record<NotificationKind, typeof Send> = { telegram: Send, smtp: Mail, webhook: Webhook }

export const kindKinds: NotificationKind[] = ['telegram', 'smtp', 'webhook']

export const kindLabel = (k: NotificationKind) => translate(`kind.${k}` as const)
