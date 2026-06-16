import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { CheckCircleIcon, InfoIcon, XCircleIcon } from '../components/ui/icons'

const meta: Meta<typeof Alert> = {
  title: 'Components/Alert',
  component: Alert,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Alert>

const variantIcons = {
  default: <InfoIcon />,
  info: <InfoIcon />,
  success: <CheckCircleIcon />,
  destructive: <XCircleIcon />,
}

type PlaygroundArgs = {
  variant: 'default' | 'info' | 'success' | 'destructive'
  showIcon: boolean
  title: string
  description: string
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    variant: 'info',
    showIcon: true,
    title: 'Heads up!',
    description: 'You can add components and dependencies to your app.',
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'info', 'success', 'destructive'],
      description:
        'Visual treatment. Sets border, text, and icon colors for the alert tone.',
    },
    showIcon: {
      control: 'boolean',
      description: 'Render an icon to the left of the title and description.',
    },
    title: { control: 'text' },
    description: { control: 'text' },
  },
  render: ({ variant, showIcon, title, description }) => (
    <Alert
      variant={variant}
      icon={showIcon ? variantIcons[variant] : undefined}
    >
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  ),
}

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex w-full flex-col gap-4">
      <Alert>
        <AlertTitle>Default</AlertTitle>
        <AlertDescription>
          Used for neutral messages that don&apos;t carry a specific tone.
        </AlertDescription>
      </Alert>

      <Alert variant="info" icon={<InfoIcon />}>
        <AlertTitle>Info</AlertTitle>
        <AlertDescription>
          Provides helpful context or guidance to the user.
        </AlertDescription>
      </Alert>

      <Alert variant="success" icon={<CheckCircleIcon />}>
        <AlertTitle>Success</AlertTitle>
        <AlertDescription>
          Confirms that an action completed successfully.
        </AlertDescription>
      </Alert>

      <Alert variant="destructive" icon={<XCircleIcon />}>
        <AlertTitle>Destructive</AlertTitle>
        <AlertDescription>
          Signals an error or action that requires attention.
        </AlertDescription>
      </Alert>

      <Alert>
        <AlertTitle>With action</AlertTitle>
        <AlertDescription>
          An optional action button can follow the description.
        </AlertDescription>
        <Button size="small" className="col-start-2 mt-2 w-fit">
          Learn more
        </Button>
      </Alert>
    </div>
  ),
}
