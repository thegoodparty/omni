import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { StatusText } from '../components/ui/status-text'
import {
  ArchiveIcon,
  CalendarClockIcon,
  CircleCheckIcon,
  CircleDotIcon,
  LoaderCircleIcon,
} from '../components/ui/icons'

const meta: Meta<typeof StatusText> = {
  component: StatusText,
  title: 'Components/StatusText',
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}
export default meta

type Story = StoryObj<typeof StatusText>

type PlaygroundArgs = {
  tone: 'primary' | 'info' | 'success' | 'warning' | 'destructive' | 'muted'
  label: string
  spinning: boolean
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    tone: 'primary',
    label: 'In progress',
    spinning: false,
  },
  argTypes: {
    tone: {
      control: 'select',
      options: [
        'primary',
        'info',
        'success',
        'warning',
        'destructive',
        'muted',
      ],
      description: 'Semantic color family for the icon and label.',
    },
    label: { control: 'text' },
    spinning: {
      control: 'boolean',
      description: 'Spins the icon for in-flight states.',
    },
  },
  render: ({ tone, label, spinning }) => (
    <StatusText
      tone={tone}
      spinning={spinning}
      icon={spinning ? <LoaderCircleIcon /> : <CircleDotIcon />}
    >
      {label}
    </StatusText>
  ),
}

export const Tones: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col items-start gap-2">
      <StatusText tone="primary" icon={<CalendarClockIcon />}>
        Scheduled
      </StatusText>
      <StatusText tone="info" icon={<CircleDotIcon />}>
        In progress
      </StatusText>
      <StatusText tone="success" icon={<CircleCheckIcon />}>
        Done
      </StatusText>
      <StatusText tone="warning" icon={<CircleDotIcon />}>
        Needs attention
      </StatusText>
      <StatusText tone="destructive" icon={<CircleDotIcon />}>
        Failed
      </StatusText>
      <StatusText tone="muted" icon={<ArchiveIcon />}>
        Archived
      </StatusText>
    </div>
  ),
}

export const Spinning: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <StatusText tone="primary" spinning icon={<LoaderCircleIcon />}>
      In progress
    </StatusText>
  ),
}

export const WithoutIcon: Story = {
  parameters: { controls: { disable: true } },
  render: () => <StatusText tone="muted">Archived</StatusText>,
}
