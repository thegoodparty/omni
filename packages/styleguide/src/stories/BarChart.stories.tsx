import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { BarChart } from '../components/ui/bar-chart'

const meta: Meta<typeof BarChart> = {
  title: 'Charts/BarChart',
  component: BarChart,
  tags: ['autodocs'],
  argTypes: {
    data: { table: { disable: true } },
    className: { table: { disable: true } },
    height: { table: { disable: true } },
  },
}

export default meta

const INCOME_DATA = [
  { name: '$0-50k', value: 20 },
  { name: '$50k-100k', value: 47 },
  { name: '$100k-150k', value: 31 },
  { name: '$150k-200k', value: 40 },
  { name: '$200k+', value: 20 },
  { name: 'Unknown', value: 4 },
]

const EDUCATION_DATA = [
  { name: 'None', value: 12 },
  { name: 'High School Diploma', value: 32 },
  { name: 'Technical School', value: 18 },
  { name: 'Some College', value: 24 },
  { name: 'College Degree', value: 14 },
  { name: 'Graduate Degree', value: 3 },
  { name: 'Unknown', value: 20 },
]

type PlaygroundArgs = {
  orientation: 'vertical' | 'horizontal'
  percentage: boolean
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    orientation: 'vertical',
    percentage: true,
  },
  argTypes: {
    orientation: {
      control: 'select',
      options: ['vertical', 'horizontal'],
      description:
        'Vertical bars grow upward with labels above. Horizontal bars grow right with labels at the end.',
    },
    percentage: {
      control: 'boolean',
      description: 'Format values as percentages.',
    },
  },
  render: ({ orientation, percentage }) => (
    <div className="w-[480px]">
      <BarChart
        data={INCOME_DATA}
        orientation={orientation}
        percentage={percentage}
      />
    </div>
  ),
}

export const Variants: StoryObj<typeof BarChart> = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-10">
      <div className="w-[480px]">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Vertical — estimated income range
        </p>
        <BarChart data={INCOME_DATA} orientation="vertical" percentage />
      </div>
      <div className="w-[480px]">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Horizontal — education
        </p>
        <BarChart data={EDUCATION_DATA} orientation="horizontal" percentage />
      </div>
    </div>
  ),
}

export const Values: StoryObj<typeof BarChart> = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-10">
      <div className="w-[480px]">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Percentage
        </p>
        <BarChart data={INCOME_DATA} orientation="vertical" percentage />
      </div>
      <div className="w-[480px]">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Count
        </p>
        <BarChart
          data={INCOME_DATA.map((d) => ({ ...d, value: d.value * 1000 }))}
          orientation="vertical"
        />
      </div>
    </div>
  ),
}
