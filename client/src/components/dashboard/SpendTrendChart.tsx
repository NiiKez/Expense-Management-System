import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { BarChart3 } from 'lucide-react'
import type { MonthlyTotal } from '@/types'
import { formatCurrency } from '@/lib/format'
import { ChartTooltip, cleanAxisProps, chartCursor } from '@/lib/chart'

interface SpendTrendChartProps {
  data: MonthlyTotal[]
  currency?: string
}

export default function SpendTrendChart({ data, currency = 'USD' }: SpendTrendChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[240px] flex-col items-center justify-center gap-2 text-muted-foreground">
        <BarChart3 className="size-6 opacity-60" aria-hidden />
        <p className="text-sm">No monthly spend data available.</p>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.95} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.5} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="month" {...cleanAxisProps} />
        <YAxis
          {...cleanAxisProps}
          width={64}
          tickFormatter={(v: number) => formatCurrency(v, currency)}
        />
        <Tooltip content={<ChartTooltip currency={currency} />} cursor={chartCursor} />
        <Bar dataKey="total" fill="url(#trendFill)" radius={[4, 4, 0, 0]} maxBarSize={56} />
      </BarChart>
    </ResponsiveContainer>
  )
}
