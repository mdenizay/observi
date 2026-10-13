import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useI18n } from '@/i18n'

interface State {
  error: Error | null
}

interface Props {
  children: ReactNode
  /** When this value changes (e.g. the route), a caught error is cleared. */
  resetKey?: unknown
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Observi UI error:', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return <ErrorView error={this.state.error} />
  }
}

function ErrorView({ error }: { error: Error }) {
  const { t } = useI18n()
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-3 text-center">
          <div className="bg-destructive/10 text-destructive flex size-10 items-center justify-center rounded-full">
            <AlertTriangle className="size-5" />
          </div>
          <h1 className="text-lg font-semibold">{t('boundary.title')}</h1>
          <p className="text-muted-foreground text-sm break-words">
            {error.message || t('boundary.unexpected')}
          </p>
          <Button onClick={() => window.location.reload()}>
            <RotateCw />
            {t('boundary.reload')}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
