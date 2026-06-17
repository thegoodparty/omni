import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import {
  CheckIcon,
  CircleAlertIcon,
  ArrowRightIcon,
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
  },
}

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="default">Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="soft">Soft</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="destructive">Destructive</Badge>
    </div>
  ),
}

export const IconLeft: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="outline">
        <CheckIcon />
        Verified
      </Badge>
      <Badge variant="destructive">
        <CircleAlertIcon />
        Alert
      </Badge>
      <Badge variant="default">
        <CheckIcon />
        Done
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
      <Badge variant="outline" asChild>
        <a href="#">
          Link
          <ArrowRightIcon />
        </a>
      </Badge>
    </div>
  ),
}

export const Pill: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge shape="pill">8</Badge>
      <Badge shape="pill" variant="destructive">
        99
      </Badge>
      <Badge shape="pill" variant="outline">
        20+
      </Badge>
    </div>
  ),
}
