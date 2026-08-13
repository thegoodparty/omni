import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { IconButton } from '../components/ui/icon-button'
import { DownloadIcon } from '../components/ui/icons'

const meta: Meta<typeof IconButton> = {
  component: IconButton,
  title: 'Components/IconButton',
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}
export default meta

type Story = StoryObj<typeof IconButton>

type PlaygroundArgs = {
  variant:
    | 'default'
    | 'secondary'
    | 'destructive'
    | 'outline'
    | 'ghost'
    | 'neutral'
    | 'link'
  size: 'small' | 'medium' | 'large' | 'xLarge'
  disabled: boolean
  loading: boolean
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    variant: 'default',
    size: 'medium',
    disabled: false,
    loading: false,
  },
  argTypes: {
    variant: {
      name: 'Style',
      control: {
        type: 'select',
        labels: {
          default: 'Default',
          secondary: 'Secondary',
          destructive: 'Destructive',
          outline: 'Outline',
          ghost: 'Ghost',
          neutral: 'Neutral',
          link: 'Link',
        },
      },
      options: [
        'default',
        'secondary',
        'destructive',
        'outline',
        'ghost',
        'neutral',
        'link',
      ],
    },
    size: {
      name: 'Size',
      control: {
        type: 'select',
        labels: {
          small: 'Small (32px)',
          medium: 'Medium (40px)',
          large: 'Large (48px)',
          xLarge: 'X-Large (64px)',
        },
      },
      options: ['small', 'medium', 'large', 'xLarge'],
    },
    loading: {
      name: 'Show loading state',
      control: 'boolean',
    },
    disabled: {
      name: 'Disabled',
      control: 'boolean',
    },
  },
  render: (args) => (
    <IconButton {...args} aria-label="Download">
      <DownloadIcon />
    </IconButton>
  ),
}

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <IconButton variant="default" aria-label="Default">
        <DownloadIcon />
      </IconButton>
      <IconButton variant="secondary" aria-label="Secondary">
        <DownloadIcon />
      </IconButton>
      <IconButton variant="destructive" aria-label="Destructive">
        <DownloadIcon />
      </IconButton>
      <IconButton variant="outline" aria-label="Outline">
        <DownloadIcon />
      </IconButton>
      <IconButton variant="ghost" aria-label="Ghost">
        <DownloadIcon />
      </IconButton>
      <IconButton variant="neutral" aria-label="Neutral">
        <DownloadIcon />
      </IconButton>
    </div>
  ),
}

export const Sizes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-center gap-4">
      <IconButton size="small" aria-label="Small">
        <DownloadIcon />
      </IconButton>
      <IconButton size="medium" aria-label="Medium">
        <DownloadIcon />
      </IconButton>
      <IconButton size="large" aria-label="Large">
        <DownloadIcon />
      </IconButton>
      <IconButton size="xLarge" aria-label="X-Large">
        <DownloadIcon />
      </IconButton>
    </div>
  ),
}

const labelClass = 'text-xs text-muted-foreground font-medium'

export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="grid grid-cols-4 gap-x-6 gap-y-3 items-center">
      <span />
      <span className={labelClass}>Normal</span>
      <span className={labelClass}>Loading</span>
      <span className={labelClass}>Disabled</span>

      <span className={labelClass}>Default</span>
      <IconButton variant="default" aria-label="Default">
        <DownloadIcon />
      </IconButton>
      <IconButton variant="default" loading aria-label="Default loading">
        <DownloadIcon />
      </IconButton>
      <IconButton variant="default" disabled aria-label="Default disabled">
        <DownloadIcon />
      </IconButton>

      <span className={labelClass}>Secondary</span>
      <IconButton variant="secondary" aria-label="Secondary">
        <DownloadIcon />
      </IconButton>
      <IconButton variant="secondary" loading aria-label="Secondary loading">
        <DownloadIcon />
      </IconButton>
      <IconButton variant="secondary" disabled aria-label="Secondary disabled">
        <DownloadIcon />
      </IconButton>

      <span className={labelClass}>Destructive</span>
      <IconButton variant="destructive" aria-label="Destructive">
        <DownloadIcon />
      </IconButton>
      <IconButton
        variant="destructive"
        loading
        aria-label="Destructive loading"
      >
        <DownloadIcon />
      </IconButton>
      <IconButton
        variant="destructive"
        disabled
        aria-label="Destructive disabled"
      >
        <DownloadIcon />
      </IconButton>

      <span className={labelClass}>Outline</span>
      <IconButton variant="outline" aria-label="Outline">
        <DownloadIcon />
      </IconButton>
      <IconButton variant="outline" loading aria-label="Outline loading">
        <DownloadIcon />
      </IconButton>
      <IconButton variant="outline" disabled aria-label="Outline disabled">
        <DownloadIcon />
      </IconButton>

      <span className={labelClass}>Ghost</span>
      <IconButton variant="ghost" aria-label="Ghost">
        <DownloadIcon />
      </IconButton>
      <IconButton variant="ghost" loading aria-label="Ghost loading">
        <DownloadIcon />
      </IconButton>
      <IconButton variant="ghost" disabled aria-label="Ghost disabled">
        <DownloadIcon />
      </IconButton>

      <span className={labelClass}>Neutral</span>
      <IconButton variant="neutral" aria-label="Neutral">
        <DownloadIcon />
      </IconButton>
      <IconButton variant="neutral" loading aria-label="Neutral loading">
        <DownloadIcon />
      </IconButton>
      <IconButton variant="neutral" disabled aria-label="Neutral disabled">
        <DownloadIcon />
      </IconButton>
    </div>
  ),
}
