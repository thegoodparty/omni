import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Checkbox, CheckboxLabel } from '../components/ui/checkbox'

const meta: Meta<typeof Checkbox> = {
  title: 'Components/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
  argTypes: {
    checked: {
      control: 'boolean',
      description:
        'Controlled checked state. Toggling this in Controls updates the checkbox immediately.',
    },
    disabled: {
      control: 'boolean',
      description: 'Prevents interaction and dims the checkbox.',
    },
  },
}

export default meta
type Story = StoryObj<typeof Checkbox>

type PlaygroundArgs = {
  checked: boolean
  disabled: boolean
  label: string
  description: string
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    checked: false,
    disabled: false,
    label: 'Accept terms and conditions',
    description: '',
  },
  argTypes: {
    checked: {
      control: 'boolean',
      description:
        'Controlled checked state. Toggling this in Controls updates the checkbox immediately.',
    },
    disabled: {
      control: 'boolean',
      description: 'Prevents interaction and dims the checkbox.',
    },
    label: {
      control: 'text',
      description: 'Label text shown next to the checkbox.',
    },
    description: {
      control: 'text',
      description: 'Optional description shown below the label.',
    },
  },
  render: ({ checked, disabled, label, description }) => (
    <CheckboxLabel
      id="playground"
      checked={checked}
      disabled={disabled}
      label={label}
      description={label && description ? description : undefined}
    />
  ),
}

export const Standalone: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-center gap-3">
      <Checkbox id="standalone-unchecked" />
      <Checkbox id="standalone-checked" defaultChecked />
      <Checkbox id="standalone-disabled" disabled />
      <Checkbox id="standalone-disabled-checked" disabled defaultChecked />
    </div>
  ),
}

export const WithLabel: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <CheckboxLabel id="with-label" label="Accept terms and conditions" />
  ),
}

export const WithDescription: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <CheckboxLabel
      id="with-description"
      label="Accept terms and conditions"
      description="You agree to our Terms of Service and Privacy Policy."
    />
  ),
}

export const Checked: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <CheckboxLabel
      id="checked"
      label="Accept terms and conditions"
      defaultChecked
    />
  ),
}

export const Focused: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-3">
      <CheckboxLabel
        id="focused-unchecked"
        label="Unchecked focused"
        className="[&_[data-slot=checkbox]]:ring-[3px] [&_[data-slot=checkbox]]:ring-components-input-focus [&_[data-slot=checkbox]]:border-base-focus-ring"
      />
      <CheckboxLabel
        id="focused-checked"
        label="Checked focused"
        defaultChecked
        className="[&_[data-slot=checkbox]]:ring-[3px] [&_[data-slot=checkbox]]:ring-components-input-focus [&_[data-slot=checkbox]]:border-components-input-active"
      />
    </div>
  ),
}

export const Disabled: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-3">
      <CheckboxLabel
        id="disabled-unchecked"
        label="Unchecked disabled"
        disabled
      />
      <CheckboxLabel
        id="disabled-checked"
        label="Checked disabled"
        disabled
        defaultChecked
      />
    </div>
  ),
}

export const Multiple: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="space-y-3">
      <CheckboxLabel id="option1" label="Notify by email" defaultChecked />
      <CheckboxLabel id="option2" label="Notify by SMS" />
      <CheckboxLabel id="option3" label="Notify by push notification" />
    </div>
  ),
}
