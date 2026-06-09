import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import {
  Avatar,
  AvatarFallback,
  AvatarIcon,
  AvatarImage,
} from '../components/ui/avatar'
import { UserIcon } from '../components/ui/icons'

const meta: Meta<typeof Avatar> = {
  component: Avatar,
  title: 'Components/Avatar',
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}
export default meta

type Story = StoryObj<typeof Avatar>

type PlaygroundArgs = {
  size: 'small' | 'medium' | 'large' | 'xLarge' | 'xxLarge'
  shape: 'circle' | 'square'
  content: 'initials' | 'image' | 'icon'
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    size: 'medium',
    shape: 'circle',
    content: 'initials',
  },
  argTypes: {
    size: {
      options: ['small', 'medium', 'large', 'xLarge', 'xxLarge'],
      control: {
        type: 'select',
        labels: {
          small: 'small (32px)',
          medium: 'medium (40px) — default',
          large: 'large (48px)',
          xLarge: 'xLarge (56px)',
          xxLarge: 'xxLarge (64px)',
        },
      },
    },
    shape: {
      control: 'select',
      options: ['circle', 'square'],
    },
    content: {
      control: 'select',
      options: ['initials', 'image', 'icon'],
      description:
        'What to display inside the avatar. "initials" shows the JD fallback text; "image" loads a photo with initials as fallback; "icon" shows a user silhouette.',
    },
  },
  render: ({ size, shape, content }) => (
    <Avatar key={content} size={size} shape={shape}>
      {content === 'image' && (
        <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
      )}
      {content === 'icon' ? (
        <AvatarIcon>
          <UserIcon />
        </AvatarIcon>
      ) : (
        <AvatarFallback>JD</AvatarFallback>
      )}
    </Avatar>
  ),
}

export const Default: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Avatar>
      <AvatarFallback>JD</AvatarFallback>
    </Avatar>
  ),
}

export const WithImage: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Avatar>
      <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
      <AvatarFallback>CN</AvatarFallback>
    </Avatar>
  ),
}

export const WithIcon: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Avatar>
      <AvatarIcon>
        <UserIcon />
      </AvatarIcon>
    </Avatar>
  ),
}

export const Sizes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-end gap-4">
      <Avatar size="small">
        <AvatarFallback>S</AvatarFallback>
      </Avatar>
      <Avatar size="medium">
        <AvatarFallback>M</AvatarFallback>
      </Avatar>
      <Avatar size="large">
        <AvatarFallback>L</AvatarFallback>
      </Avatar>
      <Avatar size="xLarge">
        <AvatarFallback>XL</AvatarFallback>
      </Avatar>
      <Avatar size="xxLarge">
        <AvatarFallback>XXL</AvatarFallback>
      </Avatar>
    </div>
  ),
}

export const Shapes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-center gap-4">
      <Avatar shape="circle">
        <AvatarFallback>JD</AvatarFallback>
      </Avatar>
      <Avatar shape="square">
        <AvatarFallback>JD</AvatarFallback>
      </Avatar>
    </div>
  ),
}
