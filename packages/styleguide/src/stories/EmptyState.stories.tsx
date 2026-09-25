import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { EmptyState } from '../components/ui/empty-state'
import { Button } from '../components/ui/button'
import { PlusIcon } from '../components/ui/icons'

const meta: Meta<typeof EmptyState> = {
  component: EmptyState,
  title: 'Components/EmptyState',
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
}
export default meta

type PlaygroundArgs = {
  message: string
  showAction: boolean
  actionLabel: string
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    message: 'No door knocking campaigns yet. Create one to start knocking.',
    showAction: true,
    actionLabel: 'Create campaign',
  },
  argTypes: {
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
  render: ({ message, showAction, actionLabel }) => (
    <EmptyState
      message={message}
      action={showAction ? <Button>{actionLabel}</Button> : undefined}
    />
  ),
}

// The two shapes this comes in. A statement and an invitation — an archive
// with nothing in it has no button that would help, so the action is
// optional rather than a required slot every caller has to fill.
export const Variants: StoryObj<typeof EmptyState> = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-4">
      <EmptyState message="No archived campaigns." />
      <EmptyState
        message="Navigate to the location you want to draw your first turf."
        action={
          <Button>
            <PlusIcon />
            Draw first turf
          </Button>
        }
      />
    </div>
  ),
}
