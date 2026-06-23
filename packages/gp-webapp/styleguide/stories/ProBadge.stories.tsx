import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useArgs } from 'storybook/preview-api'
import { ProBadge } from '../components/ui/pro-badge'

type PlaygroundArgs = {
  size: 'small' | 'default' | 'large'
  showContext: boolean
}

const meta: Meta<typeof ProBadge> = {
  title: 'Components/Pro Badge',
  component: ProBadge,
  tags: ['autodocs'],
  argTypes: {
    className: { table: { disable: true } },
  },
}

export default meta

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    size: 'default',
    showContext: false,
  },
  argTypes: {
    size: {
      control: 'inline-radio',
      options: ['small', 'default', 'large'],
      description: 'Visual size of the badge.',
    },
    showContext: {
      control: 'boolean',
      description: 'Show badge inline with text.',
    },
  },
  render: function Render() {
    const [{ size, showContext }] = useArgs<PlaygroundArgs>()
    if (showContext) {
      return (
        <p className="text-sm text-foreground">
          GoodParty.org{' '}
          <ProBadge size={size} className="ml-1 inline-block align-middle" />
        </p>
      )
    }
    return <ProBadge size={size} />
  },
}

export const Sizes: StoryObj<typeof ProBadge> = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        Sizes
      </p>
      <div className="flex items-center gap-3">
        <ProBadge size="small" />
        <ProBadge size="default" />
        <ProBadge size="large" />
      </div>
    </div>
  ),
}

export const InlineWithText: StoryObj<typeof ProBadge> = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        Inline with text
      </p>
      <p className="text-sm text-foreground">
        GoodParty.org{' '}
        <ProBadge size="small" className="ml-1 inline-block align-middle" />
      </p>
    </div>
  ),
}
