import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { PieChart } from '../components/ui/pie-chart'

const meta: Meta<typeof PieChart> = {
  title: 'Charts/PieChart',
  component: PieChart,
  tags: ['autodocs'],
  argTypes: {
    data: { table: { disable: true } },
    height: { table: { disable: true } },
  },
}

export default meta

const THREE_SEGMENTS = [
  { name: 'Yes', value: 62 },
  { name: 'No', value: 25 },
  { name: 'Unknown', value: 13 },
]

export const Playground: StoryObj<typeof PieChart> = {
  args: {
    percentage: true,
  },
  argTypes: {
    percentage: {
      control: 'boolean',
      description: 'Format legend values as percentages.',
    },
  },
  render: ({ percentage }) => (
    <div className="w-[360px]">
      <PieChart data={THREE_SEGMENTS} percentage={percentage} />
    </div>
  ),
}

export const Variants: StoryObj<typeof PieChart> = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap gap-8">
      <div className="w-[300px]">
        <p className="mb-2 text-sm font-medium text-muted-foreground">
          Two segments
        </p>
        <PieChart
          data={[
            { name: 'Yes', value: 62 },
            { name: 'No', value: 38 },
          ]}
          percentage
        />
      </div>
      <div className="w-[300px]">
        <p className="mb-2 text-sm font-medium text-muted-foreground">
          Three segments
        </p>
        <PieChart data={THREE_SEGMENTS} percentage />
      </div>
      <div className="w-[300px]">
        <p className="mb-2 text-sm font-medium text-muted-foreground">
          Four segments
        </p>
        <PieChart
          data={[
            { name: 'Yes', value: 42 },
            { name: 'Likely', value: 18 },
            { name: 'No', value: 21 },
            { name: 'Unknown', value: 19 },
          ]}
          percentage
        />
      </div>
    </div>
  ),
}

export const Values: StoryObj<typeof PieChart> = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap gap-8">
      <div className="w-[300px]">
        <p className="mb-2 text-sm font-medium text-muted-foreground">
          Percentage
        </p>
        <PieChart data={THREE_SEGMENTS} percentage />
      </div>
      <div className="w-[300px]">
        <p className="mb-2 text-sm font-medium text-muted-foreground">Count</p>
        <PieChart
          data={THREE_SEGMENTS.map((d) => ({ ...d, value: d.value * 1000 }))}
        />
      </div>
    </div>
  ),
}
