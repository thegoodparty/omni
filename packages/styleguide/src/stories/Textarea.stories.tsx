import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Textarea } from '../components/ui/textarea'
import { Label } from '../components/ui/label'

const meta: Meta<typeof Textarea> = {
  title: 'Components/Textarea',
  component: Textarea,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Textarea>

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
    {children}
  </p>
)

export const Playground: Story = {
  args: {
    placeholder: 'Type your message here.',
    disabled: false,
    rows: 3,
  },
  argTypes: {
    disabled: { control: 'boolean' },
    rows: { control: { type: 'number', min: 1, max: 20, step: 1 } },
    placeholder: { control: 'text' },
  },
  render: ({ placeholder, disabled, rows }) => (
    <Textarea placeholder={placeholder} disabled={disabled} rows={rows} />
  ),
}

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex w-full max-w-md flex-col gap-6">
      <div>
        <SectionLabel>With label</SectionLabel>
        <div className="grid gap-1.5">
          <Label htmlFor="v-message">Your message</Label>
          <Textarea placeholder="Type your message here." id="v-message" />
        </div>
      </div>
      <div>
        <SectionLabel>With description</SectionLabel>
        <div className="grid gap-1.5">
          <Label htmlFor="v-message-desc">Your message</Label>
          <Textarea placeholder="Type your message here." id="v-message-desc" />
          <p className="text-sm text-muted-foreground">
            Your message will be copied to the support team.
          </p>
        </div>
      </div>
      <div>
        <SectionLabel>Tall (10 rows)</SectionLabel>
        <Textarea placeholder="Type your message here." rows={10} />
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
    <div className="flex w-full max-w-md flex-col gap-6">
      <div>
        <SectionLabel>Default</SectionLabel>
        <Textarea placeholder="Type your message here." />
      </div>
      <div>
        <SectionLabel>Filled</SectionLabel>
        <Textarea defaultValue="This is some content that was already entered." />
      </div>
      <div>
        <SectionLabel>Active (mouse)</SectionLabel>
        <Textarea
          defaultValue="This is some content that was already entered."
          className="border-components-input-active"
        />
      </div>
      <div>
        <SectionLabel>Focus (keyboard)</SectionLabel>
        <Textarea
          defaultValue="This is some content that was already entered."
          className="border-components-input-active ring-[3px] ring-components-input-focus"
        />
      </div>
      <div>
        <SectionLabel>Disabled</SectionLabel>
        <Textarea placeholder="Type your message here." disabled />
      </div>
      <div>
        <SectionLabel>Error</SectionLabel>
        <div className="grid gap-1.5">
          <Textarea defaultValue="Help" aria-invalid />
          <p className="text-sm text-destructive">Message is too short.</p>
        </div>
      </div>
      <div>
        <SectionLabel>Error focused (keyboard)</SectionLabel>
        <div className="grid gap-1.5">
          <Textarea
            defaultValue="Help"
            aria-invalid
            className="ring-[3px] ring-destructive-focus"
          />
          <p className="text-sm text-destructive">Message is too short.</p>
        </div>
      </div>
    </div>
  ),
}
