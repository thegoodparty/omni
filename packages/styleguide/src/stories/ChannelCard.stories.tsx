import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { ChannelCard } from '../components/ui/channel-card'
import {
  ClipboardListIcon,
  DoorOpenIcon,
  HeadphonesIcon,
  MailIcon,
  MessageSquareIcon,
  PhoneIcon,
  Share2Icon,
} from '../components/ui/icons'

const meta: Meta<typeof ChannelCard> = {
  component: ChannelCard,
  title: 'Components/ChannelCard',
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}
export default meta

type Story = StoryObj<typeof ChannelCard>

type PlaygroundArgs = {
  label: string
  subCopy: string
  locked: boolean
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    label: 'Email',
    subCopy: 'From 1¢ per contact',
    locked: false,
  },
  argTypes: {
    label: { control: 'text' },
    subCopy: {
      control: 'text',
      description: 'Optional second line under the label.',
    },
    locked: {
      control: 'boolean',
      description:
        'Dims the card and shows a lock. The card stays clickable so consumers can open an upgrade prompt.',
    },
  },
  render: ({ label, subCopy, locked }) => (
    <ChannelCard
      className="w-40"
      icon={<MailIcon />}
      label={label}
      subCopy={subCopy || undefined}
      locked={locked}
    />
  ),
}

export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="grid w-100 grid-cols-2 gap-4">
      <ChannelCard icon={<MessageSquareIcon />} label="Texting" />
      <ChannelCard
        icon={<MailIcon />}
        label="Email"
        subCopy="From 1¢ per contact"
      />
      <ChannelCard icon={<PhoneIcon />} label="Robocall" locked />
      <ChannelCard
        icon={<HeadphonesIcon />}
        label="Phone banking"
        subCopy="Powered by CallHub"
        locked
      />
    </div>
  ),
}

export const IconTints: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="grid w-155 grid-cols-3 gap-4">
      <ChannelCard
        icon={<Share2Icon />}
        label="Social media"
        iconClassName="bg-secondary-light"
      />
      <ChannelCard
        icon={<DoorOpenIcon />}
        label="Door knocking"
        iconClassName="bg-success-light"
      />
      <ChannelCard
        icon={<ClipboardListIcon />}
        label="Poll / Survey"
        iconClassName="bg-tertiary-light"
      />
    </div>
  ),
}
