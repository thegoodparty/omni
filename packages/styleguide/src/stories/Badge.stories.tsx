import React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import {
  CheckIcon,
  CircleAlertIcon,
  ArrowRightIcon,
  StarIcon,
  InfoIcon,
} from '../components/ui/icons'
import { Badge } from '../components/ui/badge'

const meta: Meta<typeof Badge> = {
  title: 'Components/Badge',
  component: Badge,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Badge>

export const Playground: Story = {
  args: {
    children: 'Badge',
    variant: 'default',
    shape: 'default',
  },
  argTypes: {
    variant: {
      name: 'Variant',
      control: 'select',
      options: ['default', 'secondary', 'soft', 'destructive', 'outline'],
    },
    shape: {
      name: 'Shape',
      control: 'select',
      options: ['default', 'pill'],
    },
    children: {
      name: 'Label',
      control: 'text',
    },
    asChild: {
      table: { disable: true },
    },
  },
  render: (args) => <Badge tabIndex={0} {...args} />,
}

export const IconLeft: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="default">
        <CheckIcon />
        Done
      </Badge>
      <Badge variant="secondary">
        <StarIcon />
        Featured
      </Badge>
      <Badge variant="soft">
        <InfoIcon />
        Info
      </Badge>
      <Badge variant="outline">
        <CheckIcon />
        Verified
      </Badge>
      <Badge variant="destructive">
        <CircleAlertIcon />
        Alert
      </Badge>
    </div>
  ),
}

export const IconRight: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="default" asChild>
        <a href="#">
          Link
          <ArrowRightIcon />
        </a>
      </Badge>
      <Badge variant="secondary" asChild>
        <a href="#">
          Link
          <ArrowRightIcon />
        </a>
      </Badge>
      <Badge variant="soft" asChild>
        <a href="#">
          Link
          <ArrowRightIcon />
        </a>
      </Badge>
      <Badge variant="outline" asChild>
        <a href="#">
          Link
          <ArrowRightIcon />
        </a>
      </Badge>
      <Badge variant="destructive" asChild>
        <a href="#">
          Link
          <ArrowRightIcon />
        </a>
      </Badge>
    </div>
  ),
}

const STATE_ROWS = [
  {
    variant: 'default',
    hover: 'bg-primary/80 dark:bg-primary/70',
    focus: 'ring-[3px] ring-ring/50',
  },
  {
    variant: 'secondary',
    hover: 'bg-secondary/80 dark:bg-secondary/70',
    focus: 'ring-[3px] ring-secondary/50',
  },
  {
    variant: 'soft',
    hover: 'bg-grayscale-200/70 dark:bg-grayscale-700',
    focus: 'ring-[3px] ring-ring/50 dark:ring-primary/50',
  },
  {
    variant: 'outline',
    hover: 'bg-base-accent',
    focus: 'ring-[3px] ring-ring/50',
  },
  {
    variant: 'destructive',
    hover: 'bg-destructive/80 dark:bg-destructive/70',
    focus: 'ring-[3px] ring-destructive/20 dark:ring-destructive/40',
  },
] as const

export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-8">
      {(['default', 'pill'] as const).map((shape) => (
        <div key={shape} className="flex flex-col gap-2">
          <p className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">
            {shape}
          </p>
          <div className="grid grid-cols-[100px_80px_80px_80px] items-center gap-y-2">
            <span />
            {(['Default', 'Hover', 'Focus'] as const).map((label) => (
              <span
                key={label}
                className="text-muted-foreground text-xs font-medium"
              >
                {label}
              </span>
            ))}
            {STATE_ROWS.map(({ variant, hover, focus }) => (
              <React.Fragment key={variant}>
                <span className="text-muted-foreground text-xs capitalize">
                  {variant}
                </span>
                <Badge variant={variant} shape={shape}>
                  {shape === 'pill' ? '8' : 'Badge'}
                </Badge>
                <Badge variant={variant} shape={shape} className={hover}>
                  {shape === 'pill' ? '8' : 'Badge'}
                </Badge>
                <Badge variant={variant} shape={shape} className={focus}>
                  {shape === 'pill' ? '8' : 'Badge'}
                </Badge>
              </React.Fragment>
            ))}
          </div>
        </div>
      ))}
    </div>
  ),
}

export const Pill: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge shape="pill">8</Badge>
      <Badge shape="pill" variant="secondary">
        8
      </Badge>
      <Badge shape="pill" variant="soft">
        8
      </Badge>
      <Badge shape="pill" variant="outline">
        20+
      </Badge>
      <Badge shape="pill" variant="destructive">
        99
      </Badge>
    </div>
  ),
}
