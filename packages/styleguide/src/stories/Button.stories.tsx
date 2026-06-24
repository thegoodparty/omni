import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Button } from '../components/ui/button'
import { DownloadIcon } from '../components/ui/icons'

const meta: Meta<typeof Button> = {
  component: Button,
  title: 'Components/Button',
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}
export default meta

type Story = StoryObj<typeof Button>

type PlaygroundArgs = {
  variant:
    | 'default'
    | 'secondary'
    | 'destructive'
    | 'outline'
    | 'ghost'
    | 'link'
    | 'neutral'
  size: 'small' | 'medium' | 'large'
  disabled: boolean
  loading: boolean
  loadingText: string
  children: string
  showIcon: boolean
  iconPosition: 'left' | 'right'
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    variant: 'default',
    size: 'medium',
    disabled: false,
    loading: false,
    loadingText: '',
    children: 'Button',
    showIcon: false,
    iconPosition: 'left',
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
        },
      },
      options: ['small', 'medium', 'large'],
    },
    children: {
      name: 'Label',
      control: 'text',
    },
    loading: {
      name: 'Show loading state',
      control: 'boolean',
    },
    loadingText: {
      name: 'Loading label',
      description:
        'Text shown while loading. Defaults to the original button label.',
      control: 'text',
      if: { arg: 'loading', truthy: true },
    },
    showIcon: {
      name: 'Show icon',
      control: 'boolean',
    },
    iconPosition: {
      name: 'Icon position',
      control: 'inline-radio',
      options: ['left', 'right'],
      if: { arg: 'showIcon', truthy: true },
    },
    disabled: {
      name: 'Disabled',
      control: 'boolean',
    },
    asChild: { table: { disable: true } },
    icon: { table: { disable: true } },
  },
  render: ({ showIcon, children, loadingText, ...buttonArgs }) => (
    <Button
      {...buttonArgs}
      loadingText={loadingText || undefined}
      icon={showIcon ? <DownloadIcon /> : undefined}
    >
      {children}
    </Button>
  ),
}

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="default">Default</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="neutral">Neutral</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
}

const labelClass = 'text-xs text-muted-foreground font-medium'

export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="grid grid-cols-5 gap-x-6 gap-y-3 items-center">
      <span />
      <span className={labelClass}>Normal</span>
      <span className={labelClass}>With icon</span>
      <span className={labelClass}>Loading</span>
      <span className={labelClass}>Disabled</span>

      <span className={labelClass}>Default</span>
      <Button variant="default">Button</Button>
      <Button variant="default" icon={<DownloadIcon />}>
        Button
      </Button>
      <Button variant="default" loading>
        Button
      </Button>
      <Button variant="default" disabled>
        Button
      </Button>

      <span className={labelClass}>Secondary</span>
      <Button variant="secondary">Button</Button>
      <Button variant="secondary" icon={<DownloadIcon />}>
        Button
      </Button>
      <Button variant="secondary" loading>
        Button
      </Button>
      <Button variant="secondary" disabled>
        Button
      </Button>

      <span className={labelClass}>Destructive</span>
      <Button variant="destructive">Button</Button>
      <Button variant="destructive" icon={<DownloadIcon />}>
        Button
      </Button>
      <Button variant="destructive" loading>
        Button
      </Button>
      <Button variant="destructive" disabled>
        Button
      </Button>

      <span className={labelClass}>Outline</span>
      <Button variant="outline">Button</Button>
      <Button variant="outline" icon={<DownloadIcon />}>
        Button
      </Button>
      <Button variant="outline" loading>
        Button
      </Button>
      <Button variant="outline" disabled>
        Button
      </Button>

      <span className={labelClass}>Ghost</span>
      <Button variant="ghost">Button</Button>
      <Button variant="ghost" icon={<DownloadIcon />}>
        Button
      </Button>
      <Button variant="ghost" loading>
        Button
      </Button>
      <Button variant="ghost" disabled>
        Button
      </Button>

      <span className={labelClass}>Neutral</span>
      <Button variant="neutral">Button</Button>
      <Button variant="neutral" icon={<DownloadIcon />}>
        Button
      </Button>
      <Button variant="neutral" loading>
        Button
      </Button>
      <Button variant="neutral" disabled>
        Button
      </Button>

      <span className={labelClass}>Link</span>
      <Button variant="link">Button</Button>
      <Button variant="link" icon={<DownloadIcon />}>
        Button
      </Button>
      <Button variant="link" loading>
        Button
      </Button>
      <Button variant="link" disabled>
        Button
      </Button>
    </div>
  ),
}

export const Sizes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-center gap-4">
      <Button size="small">Small</Button>
      <Button size="medium">Medium</Button>
      <Button size="large">Large</Button>
    </div>
  ),
}
