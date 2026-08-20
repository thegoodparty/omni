import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Eyebrow } from '../components/ui/eyebrow'
import { SparklesIcon } from '../components/ui/icons'

const meta: Meta<typeof Eyebrow> = {
  component: Eyebrow,
  title: 'Components/Eyebrow',
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}
export default meta

type Story = StoryObj<typeof Eyebrow>

export const Playground: Story = {
  args: {
    children: 'Voter outreach',
  },
  argTypes: {
    children: { control: 'text' },
  },
}

export const WithIcon: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Eyebrow>
      <SparklesIcon />
      AI generated
    </Eyebrow>
  ),
}

export const AboveHeading: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-1">
      <Eyebrow>History</Eyebrow>
      <p className="text-card-foreground text-lg leading-7 font-semibold">
        Past outreach
      </p>
    </div>
  ),
}
