import type { LucideIcon } from 'lucide-react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: string
  sub?: string
  icon?: LucideIcon
  delta?: { value: number; direction: 'up' | 'down' }
}

export default function StatCard({ label, value, sub, icon: Icon, delta }: StatCardProps) {
  const isUp = delta?.direction === 'up'

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          {Icon && (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
              <Icon className="size-4" aria-hidden />
            </span>
          )}
        </div>

        <p className="mt-3 text-2xl font-semibold tabular-nums">{value}</p>

        {(delta || sub) && (
          <div className="mt-2 flex items-center gap-2">
            {delta && (
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums',
                  isUp
                    ? 'bg-success-subtle text-success'
                    : 'bg-destructive-subtle text-destructive',
                )}
              >
                {isUp ? (
                  <TrendingUp className="size-3" aria-hidden />
                ) : (
                  <TrendingDown className="size-3" aria-hidden />
                )}
                {Math.abs(delta.value)}%
              </span>
            )}
            {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
