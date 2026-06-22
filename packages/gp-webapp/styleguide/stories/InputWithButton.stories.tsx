import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { InputWithButton } from '../components/ui/input-with-button'

const meta: Meta<typeof InputWithButton> = {
  title: 'Components/InputWithButton',
  component: InputWithButton,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof InputWithButton>

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
    {children}
  </p>
)

type PlaygroundArgs = {
  label: string
  showLabel: boolean
  placeholder: string
  buttonLabel: string
  layout: 'inline' | 'stacked'
  disabled: boolean
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    label: 'Zip code',
    showLabel: true,
    placeholder: 'ZIP',
    buttonLabel: 'Search',
    layout: 'inline',
    disabled: false,
  },
  argTypes: {
    label: { control: 'text' },
    showLabel: { control: 'boolean' },
    placeholder: { control: 'text' },
    buttonLabel: { control: 'text' },
    layout: {
      control: 'inline-radio',
      options: ['inline', 'stacked'],
    },
    disabled: { control: 'boolean' },
  },
  render: ({
    label,
    showLabel,
    placeholder,
    buttonLabel,
    layout,
    disabled,
  }) => (
    <div className="w-72">
      <InputWithButton
        label={label}
        showLabel={showLabel}
        placeholder={placeholder}
        buttonLabel={buttonLabel}
        layout={layout}
        disabled={disabled}
      />
    </div>
  ),
}

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-6">
      <div>
        <SectionLabel>Inline with label</SectionLabel>
        <div className="w-72">
          <InputWithButton
            label="Zip code"
            placeholder="ZIP"
            buttonLabel="Search"
            layout="inline"
          />
        </div>
      </div>
      <div>
        <SectionLabel>Inline without label</SectionLabel>
        <div className="w-72">
          <InputWithButton
            label="Zip code"
            showLabel={false}
            placeholder="ZIP"
            buttonLabel="Search"
            layout="inline"
          />
        </div>
      </div>
      <div>
        <SectionLabel>Stacked</SectionLabel>
        <div className="w-72">
          <InputWithButton
            label="Zip code"
            placeholder="ZIP"
            buttonLabel="Search"
            layout="stacked"
          />
        </div>
      </div>
    </div>
  ),
}

// InputWithButton is a composition of Input + Button, so its input states are
// the Input component's states. The focus rows can't be forced statically, so
// they're simulated by targeting the inner input with a [&_input]: selector
// (the component's own className lands on the wrapper). Disabled and Error are
// the states unique to the pair: both dim together, and an invalid input sits
// beside an enabled button.
export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-6">
      <div>
        <SectionLabel>Default</SectionLabel>
        <div className="w-72">
          <InputWithButton
            label="Zip code"
            placeholder="ZIP"
            buttonLabel="Search"
            layout="inline"
          />
        </div>
      </div>
      <div>
        <SectionLabel>Filled</SectionLabel>
        <div className="w-72">
          <InputWithButton
            label="Zip code"
            defaultValue="94110"
            buttonLabel="Search"
            layout="inline"
          />
        </div>
      </div>
      <div>
        <SectionLabel>Active (mouse)</SectionLabel>
        <div className="w-72">
          <InputWithButton
            label="Zip code"
            defaultValue="94110"
            buttonLabel="Search"
            layout="inline"
            className="[&_input]:border-components-input-active"
          />
        </div>
      </div>
      <div>
        <SectionLabel>Focus (keyboard)</SectionLabel>
        <div className="w-72">
          <InputWithButton
            label="Zip code"
            defaultValue="94110"
            buttonLabel="Search"
            layout="inline"
            className="[&_input]:border-components-input-active [&_input]:ring-[3px] [&_input]:ring-components-input-focus"
          />
        </div>
      </div>
      <div>
        <SectionLabel>Disabled</SectionLabel>
        <div className="w-72">
          <InputWithButton
            label="Zip code"
            placeholder="ZIP"
            buttonLabel="Search"
            layout="inline"
            disabled
            buttonProps={{ disabled: true }}
          />
        </div>
      </div>
      <div>
        <SectionLabel>Error</SectionLabel>
        <div className="w-72">
          <InputWithButton
            label="Zip code"
            placeholder="ZIP"
            buttonLabel="Search"
            layout="inline"
            defaultValue="123"
            aria-invalid
          />
          <p className="mt-1.5 text-sm text-destructive">
            Enter a valid 5-digit ZIP code.
          </p>
        </div>
      </div>
      <div>
        <SectionLabel>Error focused</SectionLabel>
        <div className="w-72">
          <InputWithButton
            label="Zip code"
            placeholder="ZIP"
            buttonLabel="Search"
            layout="inline"
            defaultValue="123"
            aria-invalid
            className="[&_input]:ring-[3px] [&_input]:ring-destructive-focus"
          />
          <p className="mt-1.5 text-sm text-destructive">
            Enter a valid 5-digit ZIP code.
          </p>
        </div>
      </div>
    </div>
  ),
}
