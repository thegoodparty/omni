import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Spinner } from '../components/ui/spinner'

const meta: Meta<typeof Spinner> = {
  component: Spinner,
  title: 'Components/Spinner',
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    className: { table: { disable: true } },
  },
}
export default meta

export const Default: StoryObj<typeof Spinner> = {
  parameters: { controls: { disable: true } },
  render: () => <Spinner />,
}

export const CenteredInSection: StoryObj<typeof Spinner> = {
  parameters: { controls: { disable: true }, layout: 'fullscreen' },
  render: () => (
    <div className="flex h-[60vh] items-center justify-center">
      <Spinner />
    </div>
  ),
}
