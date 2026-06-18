import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { ProBadge } from '../components/ui/pro-badge'

const meta: Meta<typeof ProBadge> = {
  title: 'Components/Pro Badge',
  component: ProBadge,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof ProBadge>

export const Playground: Story = {
  args: {
    size: 'default',
  },
  argTypes: {
    size: {
      control: 'inline-radio',
      options: ['small', 'default', 'large'],
      description: 'Visual size of the badge.',
    },
  },
}

export const Sizes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-center gap-3">
      <ProBadge size="small" />
      <ProBadge size="default" />
      <ProBadge size="large" />
    </div>
  ),
}

export const InlineWithText: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <p className="text-sm">
      GoodParty.org{' '}
      <ProBadge size="small" className="ml-1 inline-block align-middle" />
    </p>
  ),
}
