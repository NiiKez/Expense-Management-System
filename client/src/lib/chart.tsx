/* eslint-disable react-refresh/only-export-components */
import { formatCurrency } from '@/lib/format'

/**
 * Shared chart kit for the dashboard charts. Everything here is tied to the
 * design-token CSS vars (see index.css) so light/dark mode is automatic.
 *
 * This module intentionally co-locates the `ChartTooltip` component with chart
 * constants/helpers (per the shared-kit design), so the react-refresh rule is
 * disabled for the file — these helpers are not hot-reloadable components.
 */

/** Categorical palette keyed by expense category enum -> chart CSS var. */
export const CATEGORY_CHART_COLORS: Record<string, string> = {
  TRAVEL: 'var(--chart-1)',
  MEALS: 'var(--chart-2)',
  SUPPLIES: 'var(--chart-3)',
  EQUIPMENT: 'var(--chart-4)',
  SOFTWARE: 'var(--chart-5)',
  TRAINING: 'var(--chart-6)',
  OTHER: 'var(--chart-7)',
}

/** Fallback colour for unknown categories. */
export const CHART_FALLBACK_COLOR = 'var(--chart-7)'

/** Resolve a category enum value to its chart colour. */
export function categoryColor(category: string): string {
  return CATEGORY_CHART_COLORS[category] ?? CHART_FALLBACK_COLOR
}

/** Shared axis tick style — muted, 12px. */
export const chartAxisTick = { fontSize: 12, fill: 'var(--muted-foreground)' } as const

/** Common props for "clean" recharts axes (no axis/tick lines, muted ticks). */
export const cleanAxisProps = {
  axisLine: false,
  tickLine: false,
  tick: chartAxisTick,
} as const

/** Cursor overlay used by both charts' tooltips. */
export const chartCursor = { fill: 'var(--muted)', opacity: 0.4 } as const

/** Title-case an UPPER_SNAKE enum value (e.g. EQUIPMENT -> Equipment). */
export function titleCaseEnum(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/**
 * Minimal contract for the bits of recharts' tooltip payload we actually read.
 * All optional so a recharts shape change degrades gracefully instead of being
 * swallowed by `any` (which would also hide our own typos).
 */
interface ChartTooltipProps {
  active?: boolean
  label?: string | number
  currency?: string
  payload?: Array<{ value?: number | string; payload?: { count?: number } }>
}

/** Custom recharts tooltip matching the app surface. */
export function ChartTooltip(props: ChartTooltipProps) {
  // `currency` is supplied by the chart via the <ChartTooltip currency=.../>
  // content element; recharts preserves it when it clones in active/payload.
  const { active, payload, label, currency = 'USD' } = props ?? {}
  if (!active || !payload || payload.length === 0) return null

  const entry = payload[0]
  const datum = entry?.payload ?? {}
  const value = Number(entry?.value) || 0
  const count: number | undefined =
    typeof datum.count === 'number' ? datum.count : undefined

  return (
    <div className="rounded-lg border border-border bg-popover/95 px-3 py-2 shadow-md backdrop-blur">
      <p className="text-xs font-medium text-muted-foreground">{String(label ?? '')}</p>
      <p className="text-sm font-semibold tabular-nums text-foreground">
        {formatCurrency(value, currency)}
      </p>
      {typeof count === 'number' && (
        <p className="text-xs text-muted-foreground tabular-nums">
          {count} {count === 1 ? 'expense' : 'expenses'}
        </p>
      )}
    </div>
  )
}
