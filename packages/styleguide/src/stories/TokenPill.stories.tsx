import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { TokenPill } from '../components/ui/token-pill'

const meta: Meta<typeof TokenPill> = {
  title: 'Components/TokenPill',
  component: TokenPill,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof TokenPill>

export const Playground: Story = {
  args: { children: 'First name' },
  argTypes: { children: { control: 'text' } },
}

// The same pill a review step or preview shows, so it reads as the tag the
// composer drew rather than a second design of it.
export const InText: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <p className="max-w-md text-sm">
      Hello <TokenPill>First name</TokenPill>, it&apos;s Sarah Chen, running for
      city council.
    </p>
  ),
}
