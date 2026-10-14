import { ExternalLink } from 'lucide-react'
import { CopyButton } from '@/components/copy-button'
import { useI18n } from '@/i18n'
import type { TelegramLink } from '@/lib/types'

/** Shows the one-time `/link CODE` command to send to the bot. */
export function TelegramLinkBox({ link }: { link: TelegramLink }) {
  const { t } = useI18n()
  const bot = link.bot.replace(/^@/, '')
  return (
    <div className="bg-muted/40 grid gap-2.5 rounded-lg border p-3">
      <p className="text-sm">
        {t('tg.sendTo')}{' '}
        <a href={`https://t.me/${bot}`} target="_blank" rel="noreferrer noopener" className="text-primary inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline">
          @{bot}
          <ExternalLink className="size-3" />
        </a>
        :
      </p>
      <div className="flex items-center gap-2">
        <code className="bg-card min-w-0 flex-1 overflow-x-auto rounded-md border px-3 py-2 font-mono text-sm whitespace-nowrap select-all">{link.command}</code>
        <CopyButton text={link.command} />
      </div>
      <p className="text-muted-foreground text-xs">{t('tg.expires')}</p>
    </div>
  )
}
