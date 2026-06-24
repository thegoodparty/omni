import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { SearchIcon } from '../components/ui/icons'

const meta: Meta<typeof Input> = {
  title: 'Components/Input',
  component: Input,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Input>

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
    {children}
  </p>
)

type PlaygroundArgs = {
  type: 'text' | 'email' | 'password' | 'number' | 'search' | 'file'
  placeholder: string
  disabled: boolean
  showIcon: boolean
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    type: 'text',
    placeholder: 'Enter your text here',
    disabled: false,
    showIcon: false,
  },
  argTypes: {
    type: {
      control: 'select',
      options: ['text', 'email', 'password', 'number', 'search', 'file'],
    },
    disabled: { control: 'boolean' },
    showIcon: {
      control: 'boolean',
      description: 'Render a left-aligned SearchIcon inside the input.',
    },
  },
  render: ({ type, placeholder, disabled, showIcon }) => (
    <Input
      type={type}
      placeholder={placeholder}
      disabled={disabled}
      icon={showIcon ? <SearchIcon /> : undefined}
    />
  ),
}

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex max-w-sm flex-col gap-6">
      <div>
        <SectionLabel>With label</SectionLabel>
        <div className="grid gap-1.5">
          <Label htmlFor="v-email">Email address</Label>
          <Input type="email" id="v-email" placeholder="you@example.com" />
        </div>
      </div>
      <div>
        <SectionLabel>With icon</SectionLabel>
        <Input icon={<SearchIcon />} placeholder="Search..." />
      </div>
      <div>
        <SectionLabel>Password</SectionLabel>
        <Input type="password" placeholder="••••••••" />
      </div>
      <div>
        <SectionLabel>File</SectionLabel>
        <Input type="file" />
      </div>
    </div>
  ),
}

// Active and Focus are interactive pseudo-states (:focus / :focus-visible) that
// can't be forced statically, so those two rows simulate the component's output
// with explicit token classes. Active = mouse focus (border only). Focus =
// keyboard focus (border + ring). The real component applies these via
// focus:/focus-visible: variants on the same tokens.
export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex max-w-sm flex-col gap-6">
      <div>
        <SectionLabel>Default</SectionLabel>
        <Input placeholder="Placeholder text" />
      </div>
      <div>
        <SectionLabel>Filled</SectionLabel>
        <Input defaultValue="hello@example.com" />
      </div>
      <div>
        <SectionLabel>Active (mouse)</SectionLabel>
        <Input
          defaultValue="hello@example.com"
          className="border-components-input-active"
        />
      </div>
      <div>
        <SectionLabel>Focus (keyboard)</SectionLabel>
        <Input
          defaultValue="hello@example.com"
          className="border-components-input-active ring-[3px] ring-components-input-focus"
        />
      </div>
      <div>
        <SectionLabel>Disabled</SectionLabel>
        <Input placeholder="Disabled" disabled />
      </div>
      <div>
        <SectionLabel>Error</SectionLabel>
        <div className="grid gap-1.5">
          <Input type="email" defaultValue="not-an-email" aria-invalid />
          <p className="text-sm text-destructive">
            Please enter a valid email address.
          </p>
        </div>
      </div>
      <div>
        <SectionLabel>Error focused (keyboard)</SectionLabel>
        <div className="grid gap-1.5">
          <Input
            type="email"
            defaultValue="not-an-email"
            aria-invalid
            className="ring-[3px] ring-destructive-focus"
          />
          <p className="text-sm text-destructive">
            Please enter a valid email address.
          </p>
        </div>
      </div>
    </div>
  ),
}
