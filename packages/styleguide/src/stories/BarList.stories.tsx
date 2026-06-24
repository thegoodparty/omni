import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { BarList } from '../components/ui/bar-list'

const meta: Meta<typeof BarList> = {
  title: 'Charts/BarList',
  component: BarList,
  tags: ['autodocs'],
  argTypes: {
    data: { table: { disable: true } },
    className: { table: { disable: true } },
  },
}

export default meta

const AGE_DATA = [
  { name: '18 - 25', value: 15 },
  { name: '25 - 35', value: 18 },
  { name: '35 - 50', value: 42 },
  { name: '50+', value: 25 },
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

export const Playground: StoryObj<typeof BarList> = {
  args: {
    percentage: true,
  },
  argTypes: {
    percentage: {
      control: 'boolean',
      description: 'Format values as percentages.',
    },
  },
  render: ({ percentage }) => (
    <div className="w-[480px]">
      <BarList data={AGE_DATA} percentage={percentage} />
    </div>
  ),
}

export const Variants: StoryObj<typeof BarList> = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-8">
      <div className="w-[480px]">
        <p className="mb-2 text-sm font-medium text-muted-foreground">
          Short labels — age distribution
        </p>
        <BarList data={AGE_DATA} percentage />
      </div>
      <div className="w-[480px]">
        <p className="mb-2 text-sm font-medium text-muted-foreground">
          Long labels — education
        </p>
        <BarList data={EDUCATION_DATA} percentage />
      </div>
      <div className="w-[300px]">
        <p className="mb-2 text-sm font-medium text-muted-foreground">
          Narrow container
        </p>
        <BarList data={AGE_DATA} percentage />
      </div>
    </div>
  ),
}

export const Values: StoryObj<typeof BarList> = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap gap-8">
      <div className="w-[480px]">
        <p className="mb-2 text-sm font-medium text-muted-foreground">
          Percentage
        </p>
        <BarList data={AGE_DATA} percentage />
      </div>
      <div className="w-[480px]">
        <p className="mb-2 text-sm font-medium text-muted-foreground">Count</p>
        <BarList
          data={AGE_DATA.map((d) => ({ ...d, value: d.value * 1000 }))}
        />
      </div>
    </div>
  ),
}
