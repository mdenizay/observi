import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { TelegramLinkBox } from '@/components/telegram-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n'
import { api, errorMessage } from '@/lib/api'
import type { TelegramLink } from '@/lib/types'

const key = ['telegram-link'] as const

export function TelegramCard() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [link, setLink] = useState<TelegramLink | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  // While a code is on screen, poll so the card flips to "Linked" by itself.
  const q = useQuery({ queryKey: key, queryFn: api.telegramStatus, refetchInterval: link ? 3000 : false })
  const linked = q.data?.linked === true
  const available = q.data?.available === true
  const showLink = link && !linked

  const start = async () => {
    setBusy(true)
    try {
      setLink(await api.telegramLink())
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1.5">
            <CardTitle className="text-base">{t('tg.title')}</CardTitle>
            <CardDescription>{t('tg.desc')}</CardDescription>
          </div>
          {q.data && (
            <Badge variant={linked ? 'up' : 'muted'} className="shrink-0">
              <Send />
              {linked ? t('tg.linked') : t('tg.notLinked')}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {q.isPending ? (
          <Skeleton className="h-9 w-40" />
        ) : q.isError ? (
          <p className="text-muted-foreground text-sm">{errorMessage(q.error)}</p>
        ) : linked ? (
          <div>
            <Button variant="outline" onClick={() => setConfirm(true)}>
              {t('tg.unlink')}
            </Button>
          </div>
        ) : (
          <>
            {showLink && <TelegramLinkBox link={link} />}
            <div>
              <Button onClick={start} disabled={busy || !available} variant={showLink ? 'outline' : 'default'}>
                {busy ? <Loader2 className="animate-spin" /> : <Send />}
                {showLink ? t('tg.newCode') : t('tg.link')}
              </Button>
            </div>
            {!available && (
              <p className="text-muted-foreground text-xs">
                {t('tg.unavailable')}{' '}
                <Link to="/notifications" className="text-primary underline-offset-4 hover:underline">
                  {t('users.mailSetup')}
                </Link>
              </p>
            )}
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('tg.unlinkTitle')}
        description={t('tg.unlinkDesc')}
        confirmLabel={t('tg.unlink')}
        onConfirm={async () => {
          try {
            await api.telegramUnlink()
            setLink(null)
            toast.success(t('tg.unlinked'))
            qc.invalidateQueries({ queryKey: key })
          } catch (e) {
            toast.error(errorMessage(e))
            throw e
          }
        }}
      />
    </Card>
  )
}
