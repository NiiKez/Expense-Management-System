import { Component, type ErrorInfo, type ReactNode } from 'react'
import { QueryErrorResetBoundary } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import EmptyState from './EmptyState'
import { Button } from '@/components/ui/button'

interface FallbackArgs {
  error: Error
  reset: () => void
}

interface ErrorBoundaryProps {
  children: ReactNode
  /** Render-prop for a custom fallback. Defaults to the app's EmptyState UI. */
  fallback?: (args: FallbackArgs) => ReactNode
  /**
   * Called from the fallback's reset alongside clearing local error state.
   * Wired to QueryErrorResetBoundary's reset by {@link AppErrorBoundary} so a
   * "Try again" also clears errored queries and lets them refetch.
   */
  onReset?: () => void
}

interface ErrorBoundaryState {
  error: Error | null
}

function defaultFallback({ reset }: FallbackArgs): ReactNode {
  return (
    <div role="alert" className="py-8">
      <EmptyState
        icon={<AlertTriangle className="size-6 text-destructive" />}
        title="Something went wrong"
        description="An unexpected error occurred while rendering this view. You can try again — if it keeps happening, reload the page."
        action={
          <Button size="sm" variant="outline" onClick={reset}>
            Try again
          </Button>
        }
      />
    </div>
  )
}

/**
 * Class error boundary in the app's design language. Catches render-time
 * throws below it and shows a recovery fallback instead of a blank screen.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep a console trace for debugging; no external reporting wired up yet.
    console.error('ErrorBoundary caught an error:', error, info.componentStack)
  }

  reset = (): void => {
    this.props.onReset?.()
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (error) {
      const fallback = this.props.fallback ?? defaultFallback
      return fallback({ error, reset: this.reset })
    }
    return this.props.children
  }
}

interface AppErrorBoundaryProps {
  children: ReactNode
  fallback?: (args: FallbackArgs) => ReactNode
}

/**
 * Convenience wrapper that ties the boundary's reset to TanStack Query's
 * QueryErrorResetBoundary, so "Try again" both clears the boundary and lets
 * errored queries refetch.
 */
export function AppErrorBoundary({ children, fallback }: AppErrorBoundaryProps) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary onReset={reset} fallback={fallback}>
          {children}
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  )
}

export default ErrorBoundary
