import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { EmptyState } from '../components/ui/empty-state'
import { Button } from '../components/ui/button'

const meta: Meta<typeof EmptyState> = {
  component: EmptyState,
  title: 'Components/EmptyState',
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
}
export default meta

type PlaygroundArgs = {
  title: string
  message: string
  showAction: boolean
  actionLabel: string
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    title: '',
    message: 'No door knocking campaigns yet. Create one to start knocking.',
    showAction: true,
    actionLabel: 'Create campaign',
  },
  argTypes: {
    title: {
      control: 'text',
      description: 'An optional heading over the sentence. Empty renders none.',
    },
    message: {
      control: 'text',
      description:
        'What is here, or is not. One sentence of twenty words or fewer.',
    },
    showAction: {
      control: 'boolean',
      description: 'Whether to render a CTA under the sentence.',
    },
    actionLabel: {
      control: 'text',
      description: 'The CTA’s label.',
      if: { arg: 'showAction' },
    },
  },
  render: ({ title, message, showAction, actionLabel }) => (
    <EmptyState
      title={title || undefined}
      message={message}
      action={showAction ? <Button>{actionLabel}</Button> : undefined}
    />
  ),
}

// The three shapes this comes in. A statement, an invitation, and an
// invitation that has room for a heading — an archive with nothing in it
// has no button that would help, and a row in a table has no room for a
// title, so both slots are optional rather than ones every caller fills.
export const Variants: StoryObj<typeof EmptyState> = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-4">
      <EmptyState message="No archived campaigns." />
      <EmptyState
        message="Navigate the map to the location you want to draw your first turf."
        action={<Button>Draw the first turf</Button>}
      />
      <EmptyState
        title="No turfs yet"
        message="Navigate the map to the location you want to draw your first turf."
        action={<Button>Draw the first turf</Button>}
      />
    </div>
  ),
}
