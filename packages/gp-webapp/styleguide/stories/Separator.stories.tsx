import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Separator } from '../components/ui/separator'

const meta: Meta<typeof Separator> = {
  title: 'Components/Separator',
  component: Separator,
  tags: ['autodocs'],
  argTypes: {
    orientation: {
      control: 'inline-radio',
      options: ['horizontal', 'vertical'],
      description: 'Direction the separator runs.',
    },
    decorative: {
      control: 'boolean',
      description:
        'When true the separator is purely visual; when false it is exposed to assistive tech.',
    },
  },
}

export default meta
type Story = StoryObj<typeof Separator>

export const Playground: Story = {
  args: {
    orientation: 'horizontal',
    decorative: true,
  },
  render: (args) => (
    <div
      className={
        args.orientation === 'vertical'
          ? 'flex h-24 items-center gap-4'
          : 'w-80 space-y-4'
      }
    >
      <span className="text-foreground text-sm">Section one</span>
      <Separator {...args} />
      <span className="text-foreground text-sm">Section two</span>
    </div>
  ),
}

export const Horizontal: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="w-80">
      <div className="space-y-1">
        <h4 className="text-foreground text-sm font-semibold">
          Campaign settings
        </h4>
        <p className="text-muted-foreground text-sm">
          Configure how your campaign appears to voters.
        </p>
      </div>
      <Separator className="my-4" />
      <p className="text-muted-foreground text-sm">
        Manage visibility, verification, and status settings.
      </p>
    </div>
  ),
}

export const Vertical: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="text-foreground flex h-12 items-center gap-3 text-sm">
      <span>Draft</span>
      <Separator orientation="vertical" />
      <span>Review</span>
      <Separator orientation="vertical" />
      <span>Published</span>
    </div>
  ),
}

export const InContext: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="w-full max-w-sm">
      <div className="space-y-1">
        <h4 className="text-foreground text-sm font-semibold">GoodParty.org</h4>
        <p className="text-muted-foreground text-sm">
          Run, win, and serve as an independent.
        </p>
      </div>
      <Separator className="my-4" />
      <div className="text-foreground flex h-5 items-center gap-4 text-sm">
        <span>About</span>
        <Separator orientation="vertical" />
        <span>Candidates</span>
        <Separator orientation="vertical" />
        <span>Donate</span>
      </div>
    </div>
  ),
}
