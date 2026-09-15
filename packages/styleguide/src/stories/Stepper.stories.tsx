import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Stepper } from '../components/ui/stepper'
import { Badge } from '../components/ui/badge'
import { GoodPartyOrgLogo } from '../components/ui/good-party-org-logo'

const meta: Meta<typeof Stepper> = {
  title: 'Components/Stepper',
  component: Stepper,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Stepper>

// Plain bars — a stepper without any header row (no eyebrow, no exit).
export const Bar: Story = {
  parameters: { controls: { disable: true } },
  render: () => <Stepper variant="bar" currentStep={2} totalSteps={5} />,
}

// Eyebrow only: a flow whose sheet chrome carries its own close (CRM
// wizard, team invite drawer) or that has no exit at all (onboarding).
// Any ReactNode works — a badge, a logo, or plain text.
export const WithEyebrow: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-6">
      <Stepper
        variant="bar"
        currentStep={2}
        totalSteps={5}
        eyebrow={
          <Badge className="bg-brand-blue-100 text-foreground">SMS</Badge>
        }
      />
      <Stepper
        variant="bar"
        currentStep={1}
        totalSteps={3}
        eyebrow={
          <span className="text-base font-semibold text-foreground">
            Create new list
          </span>
        }
      />
      <Stepper
        variant="bar"
        currentStep={3}
        totalSteps={10}
        eyebrow={<GoodPartyOrgLogo />}
      />
    </div>
  ),
}

// Eyebrow + Exit: the outreach flow pattern. Every channel flow renders
// the stepper this way — the badge names the channel, the Exit button
// leaves the flow.
export const WithEyebrowAndExit: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Stepper
      variant="bar"
      currentStep={2}
      totalSteps={5}
      eyebrow={
        <Badge className="border-transparent bg-brand-blue-100 text-foreground">
          SMS
        </Badge>
      }
      onExit={() => {}}
    />
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
