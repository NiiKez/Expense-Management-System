import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
  ResponsiveContainer,
} from 'recharts'
import { PieChart } from 'lucide-react'
import type { CategoryTotal } from '@/types'
import { formatCurrency } from '@/lib/format'
import {
  ChartTooltip,
  cleanAxisProps,
  chartCursor,
  categoryColor,
  titleCaseEnum,
} from '@/lib/chart'

interface SpendByCategoryChartProps {
  data: CategoryTotal[]
  currency?: string
}

export default function SpendByCategoryChart({ data, currency = 'USD' }: SpendByCategoryChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-muted-foreground">
        <PieChart className="size-6 opacity-60" aria-hidden />
        <p className="text-sm">No category spend data available.</p>
      </div>
    )
  }

  const height = Math.max(200, data.length * 46)

  // The API serialises MySQL DECIMAL totals as strings; recharts needs real
  // numbers to size the bars and compute the value-axis domain.
  const chartData = data.map((d) => ({ ...d, total: Number(d.total) || 0 }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 56, left: 8, bottom: 4 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          type="number"
          {...cleanAxisProps}
          domain={[0, 'auto']}
          tickFormatter={(v: number) => formatCurrency(v, currency)}
        />
        <YAxis
          type="category"
          dataKey="category"
          {...cleanAxisProps}
          width={108}
          tickFormatter={(v: string) => titleCaseEnum(v)}
        />
        <Tooltip content={<ChartTooltip currency={currency} />} cursor={chartCursor} />
        <Bar dataKey="total" radius={[0, 4, 4, 0]} maxBarSize={26}>
          {data.map((entry) => (
            <Cell key={entry.category} fill={categoryColor(entry.category)} />
          ))}
          <LabelList
            dataKey="total"
            position="right"
            className="fill-muted-foreground tabular-nums"
            fontSize={11}
            formatter={(value: number) => formatCurrency(value, currency)}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
