import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '../components/ui/alert'
import { Button } from '../components/ui/button'
import {
  CheckCircleIcon,
  InfoIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from '../components/ui/icons'

const meta: Meta<typeof Alert> = {
  title: 'Components/Alert',
  component: Alert,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Alert>

const variantIcons = {
  default: <TriangleAlertIcon />,
  info: <InfoIcon />,
  success: <CheckCircleIcon />,
  destructive: <XCircleIcon />,
}

type PlaygroundArgs = {
  variant: 'default' | 'info' | 'success' | 'destructive'
  showIcon: boolean
  title: string
  showDescription: boolean
  description: string
  showAction: boolean
  actionLabel: string
  actionVariant: 'alertOutline' | 'alertFilled'
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    variant: 'info',
    showIcon: true,
    title: 'Heads up!',
    showDescription: true,
    description: 'You can add components and dependencies to your app.',
    showAction: false,
    actionLabel: 'Learn more',
    actionVariant: 'alertOutline',
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
    title: { control: 'text', description: 'Primary alert message.' },
    showDescription: {
      control: 'boolean',
      description: 'Show supporting description text below the title.',
    },
    description: {
      control: 'text',
      description: 'Supporting text below the title.',
      if: { arg: 'showDescription', truthy: true },
    },
    showAction: {
      control: 'boolean',
      description: 'Render an action button below the description.',
    },
    actionLabel: {
      control: 'text',
      description: 'Label for the action button.',
      if: { arg: 'showAction', truthy: true },
    },
    actionVariant: {
      control: 'select',
      options: ['alertOutline', 'alertFilled'],
      description:
        "Button style for the action. Both variants automatically use the alert's accent color.",
      if: { arg: 'showAction', truthy: true },
    },
  },
  render: ({
    variant,
    showIcon,
    title,
    showDescription,
    description,
    showAction,
    actionLabel,
    actionVariant,
  }) => (
    <Alert
      variant={variant}
      icon={showIcon ? variantIcons[variant] : undefined}
    >
      <AlertTitle>{title}</AlertTitle>
      {showDescription && <AlertDescription>{description}</AlertDescription>}
      {showAction && (
        <AlertAction>
          <Button variant={actionVariant} size="small">
            {actionLabel}
          </Button>
        </AlertAction>
      )}
    </Alert>
  ),
}

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex w-full flex-col gap-4">
      <Alert icon={<TriangleAlertIcon />}>
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

      <Alert icon={<TriangleAlertIcon />}>
        <AlertTitle>With action</AlertTitle>
        <AlertDescription>
          An optional action can follow using AlertAction.
        </AlertDescription>
        <AlertAction>
          <Button variant="outline" size="small">
            Learn more
          </Button>
        </AlertAction>
      </Alert>
    </div>
  ),
}

export const Info: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Alert variant="info" icon={<InfoIcon />}>
      <AlertTitle>New feature available</AlertTitle>
      <AlertDescription>
        Check out the new dashboard — it&apos;s now available for all users.
      </AlertDescription>
    </Alert>
  ),
}

export const Success: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Alert variant="success" icon={<CheckCircleIcon />}>
      <AlertTitle>Your changes have been saved.</AlertTitle>
      <AlertDescription>
        The campaign profile was updated successfully.
      </AlertDescription>
    </Alert>
  ),
}

export const Destructive: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Alert variant="destructive" icon={<XCircleIcon />}>
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>
        Your session has expired. Please log in again to continue.
      </AlertDescription>
    </Alert>
  ),
}
