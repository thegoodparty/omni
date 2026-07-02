import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useArgs } from 'storybook/preview-api'
import { Stepper } from '../components/ui/stepper'

const meta: Meta<typeof Stepper> = {
  title: 'Components/Stepper',
  component: Stepper,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Stepper>

type PlaygroundArgs = {
  variant: 'bar' | 'vertical'
  currentStep: number
  totalSteps: number
  showLabel: boolean
  size: 'small' | 'medium'
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    variant: 'bar',
    currentStep: 2,
    totalSteps: 5,
    showLabel: true,
    size: 'medium',
  },
  argTypes: {
    variant: { control: 'radio', options: ['bar', 'vertical'] },
    currentStep: { control: { type: 'number', min: 1, max: 15 } },
    totalSteps: { control: { type: 'number', min: 1, max: 15 } },
    showLabel: { control: 'boolean', if: { arg: 'variant', eq: 'bar' } },
    size: {
      control: 'radio',
      options: ['small', 'medium'],
      if: { arg: 'variant', eq: 'vertical' },
    },
  },
  render: () => {
    const [{ variant, currentStep, totalSteps, showLabel, size }] =
      useArgs<PlaygroundArgs>()

    if (variant === 'vertical') {
      return (
        <Stepper
          variant="vertical"
          currentStep={currentStep}
          size={size}
          labels={Array.from(
            { length: totalSteps },
            (_, index) => `Step ${index + 1}`,
          )}
          className="w-72"
        />
      )
    }

    return (
      <Stepper
        variant="bar"
        currentStep={currentStep}
        totalSteps={totalSteps}
        showLabel={showLabel}
      />
    )
  },
}

export const BarStates: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">first step</p>
        <Stepper variant="bar" currentStep={1} totalSteps={5} />
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">mid step</p>
        <Stepper variant="bar" currentStep={2} totalSteps={5} />
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">last step</p>
        <Stepper variant="bar" currentStep={5} totalSteps={5} />
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          without label
        </p>
        <Stepper
          variant="bar"
          currentStep={2}
          totalSteps={5}
          showLabel={false}
        />
      </div>
    </div>
  ),
}

export const Vertical: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stepper
      variant="vertical"
      currentStep={1}
      labels={[
        'Campaign EIN',
        'Campaign details',
        'Candidate profile',
        'Payment',
      ]}
      className="w-72"
    />
  ),
}

export const VerticalSizes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-start gap-8">
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">medium</p>
        <Stepper
          variant="vertical"
          currentStep={1}
          size="medium"
          labels={[
            'Campaign EIN',
            'Campaign details',
            'Candidate profile',
            'Payment',
          ]}
          className="w-72"
        />
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">small</p>
        <Stepper
          variant="vertical"
          currentStep={1}
          size="small"
          labels={[
            'Campaign EIN',
            'Campaign details',
            'Candidate profile',
            'Payment',
          ]}
          className="w-72"
        />
      </div>
    </div>
  ),
}

export const VerticalLongLabels: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stepper
      variant="vertical"
      currentStep={2}
      labels={[
        'Confirm your campaign employer identification number',
        'Provide your campaign details and filing jurisdiction',
        'Set up your candidate profile for voters',
        'Add a payment method to activate your campaign',
      ]}
      className="w-72"
    />
  ),
}
