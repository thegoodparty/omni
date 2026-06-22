import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Label } from '../components/ui/label'
import { Input } from '../components/ui/input'
import { Checkbox } from '../components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group'
import { Switch } from '../components/ui/switch'

const meta: Meta<typeof Label> = {
  title: 'Components/Label',
  component: Label,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Label>

type PlaygroundArgs = {
  text: string
  variant: 'primary' | 'secondary'
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    text: 'Email address',
    variant: 'primary',
  },
  argTypes: {
    text: {
      control: 'text',
      description: 'Label text',
    },
    variant: {
      control: { type: 'select' },
      options: ['primary', 'secondary'],
      description:
        'primary — field and group headings (medium weight). secondary — inline item labels next to checkboxes, switches, and radio buttons (normal weight).',
    },
  },
  render: ({ text, variant }) => (
    <div className="grid w-full max-w-sm items-center gap-1.5">
      <Label htmlFor="playground-input" variant={variant}>
        {text}
      </Label>
      <Input
        type="email"
        id="playground-input"
        placeholder="Enter your email"
      />
    </div>
  ),
}

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-6 max-w-sm">
      <div className="grid gap-1.5">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Primary — field and group headings
        </p>
        <Label htmlFor="v-email">Email address</Label>
        <Input type="email" id="v-email" placeholder="jane@example.com" />
      </div>
      <div className="flex items-center gap-2">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Secondary — inline item labels
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Checkbox id="v-terms" />
          <Label
            htmlFor="v-terms"
            variant="secondary"
            className="cursor-pointer"
          >
            Accept terms and conditions
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroup defaultValue="opt-a">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="opt-a" id="v-r1" />
              <Label
                htmlFor="v-r1"
                variant="secondary"
                className="cursor-pointer"
              >
                Option A
              </Label>
            </div>
          </RadioGroup>
        </div>
      </div>
    </div>
  ),
}

export const WithInput: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="grid w-full max-w-sm items-center gap-1.5">
      <Label htmlFor="wi-email">Email address</Label>
      <Input type="email" id="wi-email" placeholder="Enter your email" />
    </div>
  ),
}

export const WithCheckbox: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="wc-terms" />
      <Label htmlFor="wc-terms" variant="secondary" className="cursor-pointer">
        Accept terms and conditions
      </Label>
    </div>
  ),
}

export const WithCheckboxGroup: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="grid gap-1.5">
      <Label>Preferred contact methods</Label>
      <div className="mt-1 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Checkbox id="wcg-email" defaultChecked />
          <Label
            htmlFor="wcg-email"
            variant="secondary"
            className="cursor-pointer"
          >
            Email
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="wcg-sms" />
          <Label
            htmlFor="wcg-sms"
            variant="secondary"
            className="cursor-pointer"
          >
            SMS
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="wcg-mail" />
          <Label
            htmlFor="wcg-mail"
            variant="secondary"
            className="cursor-pointer"
          >
            Mail
          </Label>
        </div>
      </div>
    </div>
  ),
}

export const WithRadioGroup: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="grid gap-1.5">
      <Label>Notification frequency</Label>
      <RadioGroup defaultValue="comfortable" className="mt-1">
        <div className="flex items-center gap-2">
          <RadioGroupItem value="default" id="wr-r1" />
          <Label htmlFor="wr-r1" variant="secondary" className="cursor-pointer">
            Daily
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="comfortable" id="wr-r2" />
          <Label htmlFor="wr-r2" variant="secondary" className="cursor-pointer">
            Weekly
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="compact" id="wr-r3" />
          <Label htmlFor="wr-r3" variant="secondary" className="cursor-pointer">
            Monthly
          </Label>
        </div>
      </RadioGroup>
    </div>
  ),
}

export const WithSwitch: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="grid gap-1.5">
      <Label>Notifications</Label>
      <div className="mt-1 flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Switch id="ws-email" defaultChecked />
          <Label
            htmlFor="ws-email"
            variant="secondary"
            className="cursor-pointer"
          >
            Email me about campaign updates
          </Label>
        </div>
        <div className="flex items-center gap-3">
          <Switch id="ws-sms" />
          <Label
            htmlFor="ws-sms"
            variant="secondary"
            className="cursor-pointer"
          >
            Send SMS alerts for new donations
          </Label>
        </div>
      </div>
    </div>
  ),
}
