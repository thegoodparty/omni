'use client'

import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import {
  CHART_COLORS,
  formatChartNumber,
  formatChartPercent,
} from '@styleguide/lib/chart'
import { cn } from '@styleguide/lib/utils'

interface BarChartItem {
  name: string
  value: number
}

interface BarChartProps {
  data?: BarChartItem[]
  orientation?: 'vertical' | 'horizontal'
  percentage?: boolean
  height?: number
  className?: string
}

const BarChart = ({
  data = [],
  orientation = 'vertical',
  percentage = false,
  height = 280,
  className,
}: BarChartProps): React.JSX.Element => {
  const formatValue = (v: number | string) => {
    const num = typeof v === 'number' ? v : parseFloat(String(v))
    return percentage ? `${formatChartPercent(num)}%` : formatChartNumber(num)
  }

  const labelStyle = { fill: 'currentColor', fontSize: 12 }

  return (
    <div className={cn('w-full text-foreground', className)}>
      <ResponsiveContainer width="100%" height={height}>
        {orientation === 'vertical' ? (
          <RechartsBarChart
            data={data}
            margin={{ top: 24, right: 4, bottom: 4, left: 4 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--base-border)"
              strokeOpacity={0.5}
            />
            <XAxis dataKey="name" hide />
            <YAxis hide domain={percentage ? [0, 100] : ['auto', 'auto']} />
            <Bar
              dataKey="value"
              radius={[6, 6, 0, 0]}
              isAnimationActive={false}
            >
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${entry.name}`}
                  fill={CHART_COLORS[index % CHART_COLORS.length]}
                />
              ))}
              <LabelList
                dataKey="value"
                position="top"
                style={labelStyle}
                formatter={formatValue}
              />
            </Bar>
          </RechartsBarChart>
        ) : (
          <RechartsBarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 44, bottom: 4, left: 4 }}
          >
            <CartesianGrid
              horizontal={false}
              stroke="var(--base-border)"
              strokeOpacity={0.5}
            />
            <XAxis
              type="number"
              hide
              domain={percentage ? [0, 100] : ['auto', 'auto']}
            />
            <YAxis type="category" dataKey="name" hide />
            <Bar
              dataKey="value"
              radius={[0, 6, 6, 0]}
              isAnimationActive={false}
            >
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${entry.name}`}
                  fill={CHART_COLORS[index % CHART_COLORS.length]}
                />
              ))}
              <LabelList
                dataKey="value"
                position="right"
                style={labelStyle}
                formatter={formatValue}
              />
            </Bar>
          </RechartsBarChart>
        )}
      </ResponsiveContainer>
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1.5 px-2 pt-2">
        {data.map((item, index) => (
          <div
            key={`legend-${item.name}`}
            className="flex items-center gap-1.5"
          >
            <span
              className="inline-block shrink-0 rounded-full"
              style={{
                backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
                width: 8,
                height: 8,
              }}
            />
            <span className="text-xs text-muted-foreground">{item.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export { BarChart, type BarChartItem, type BarChartProps }
