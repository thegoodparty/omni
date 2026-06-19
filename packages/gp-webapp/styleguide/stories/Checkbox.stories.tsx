import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useArgs } from 'storybook/preview-api'
import { Checkbox, CheckboxLabel } from '../components/ui/checkbox'

const meta: Meta<typeof Checkbox> = {
  title: 'Components/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
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
  render: function Render({ checked, disabled, label, description }) {
    const [, updateArgs] = useArgs()
    return (
      <CheckboxLabel
        id="playground"
        checked={checked}
        disabled={disabled}
        label={label}
        description={label && description ? description : undefined}
        onCheckedChange={(next) =>
          updateArgs({ checked: next === 'indeterminate' ? false : next })
        }
      />
    )
  },
}

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          Standalone
        </p>
        <Checkbox id="bare" />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          With label
        </p>
        <CheckboxLabel id="with-label" label="Accept terms and conditions" />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          With label and description
        </p>
        <CheckboxLabel
          id="with-description"
          label="Accept terms and conditions"
          description="You agree to our Terms of Service and Privacy Policy."
        />
      </div>
    </div>
  ),
}

export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          Default
        </p>
        <CheckboxLabel id="default-unchecked" label="Unchecked" />
        <CheckboxLabel id="default-checked" label="Checked" defaultChecked />
      </div>
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          Focused
        </p>
        <CheckboxLabel
          id="focused-unchecked"
          label="Unchecked focused"
          checkboxClassName="ring-[3px] ring-components-input-focus border-base-focus-ring"
        />
        <CheckboxLabel
          id="focused-checked"
          label="Checked focused"
          defaultChecked
          checkboxClassName="ring-[3px] ring-components-input-focus border-components-input-active"
        />
      </div>
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          Disabled
        </p>
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
