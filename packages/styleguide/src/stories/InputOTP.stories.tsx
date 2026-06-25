import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '../components/ui/input-otp'

const meta: Meta<typeof InputOTP> = {
  title: 'Components/Input OTP',
  component: InputOTP,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof InputOTP>

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
    {children}
  </p>
)

export const Playground: Story = {
  args: {
    maxLength: 6,
    disabled: false,
  },
  argTypes: {
    maxLength: {
      control: { type: 'number', min: 4, max: 8, step: 1 },
      description: 'Total number of slots.',
    },
    disabled: {
      control: 'boolean',
      description: 'Disable input.',
    },
  },
  render: ({ maxLength = 6, disabled }) => (
    <InputOTP maxLength={maxLength} disabled={disabled}>
      <InputOTPGroup>
        {Array.from({ length: maxLength }).map((_, i) => (
          <InputOTPSlot key={i} index={i} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  ),
}

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-6">
      <div>
        <SectionLabel>4 digits</SectionLabel>
        <InputOTP maxLength={4}>
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
            <InputOTPSlot index={3} />
          </InputOTPGroup>
        </InputOTP>
      </div>
      <div>
        <SectionLabel>6 digits</SectionLabel>
        <InputOTP maxLength={6}>
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTP>
      </div>
      <div>
        <SectionLabel>With separator</SectionLabel>
        <InputOTP maxLength={6}>
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
          </InputOTPGroup>
          <InputOTPSeparator />
          <InputOTPGroup>
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTP>
      </div>
    </div>
  ),
}

// The OTP differs from the text inputs. Its focus is managed in JS by the
// input-otp library, so the active slot shows the same border + ring whether
// you used the mouse or the keyboard. There is no separate mouse-only state,
// so this has a single Focused row (not the Active/Focus split the text
// inputs use). Focused and Error focused simulate the active slot's classes
// since the state can't be forced statically; Error uses real aria-invalid.
export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => {
    const PartialFill = () => {
      const [value, setValue] = useState('123')
      return (
        <InputOTP maxLength={6} value={value} onChange={setValue}>
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTP>
      )
    }
    return (
      <div className="flex flex-col gap-6">
        <div>
          <SectionLabel>Empty</SectionLabel>
          <InputOTP maxLength={6}>
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        </div>
        <div>
          <SectionLabel>Partial fill</SectionLabel>
          <PartialFill />
        </div>
        <div>
          <SectionLabel>Focused</SectionLabel>
          <InputOTP maxLength={6}>
            <InputOTPGroup>
              <InputOTPSlot
                index={0}
                className="z-10 border-components-input-active ring-[3px] ring-components-input-focus"
              />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        </div>
        <div>
          <SectionLabel>Disabled</SectionLabel>
          <InputOTP maxLength={6} disabled>
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        </div>
        <div>
          <SectionLabel>Error</SectionLabel>
          <InputOTP maxLength={6} value="123">
            <InputOTPGroup>
              {Array.from({ length: 6 }).map((_, i) => (
                <InputOTPSlot key={i} index={i} aria-invalid />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>
        <div>
          <SectionLabel>Error focused</SectionLabel>
          <InputOTP maxLength={6} value="123">
            <InputOTPGroup>
              <InputOTPSlot index={0} aria-invalid />
              <InputOTPSlot index={1} aria-invalid />
              <InputOTPSlot index={2} aria-invalid />
              <InputOTPSlot
                index={3}
                aria-invalid
                className="z-10 ring-[3px] ring-destructive-focus"
              />
              <InputOTPSlot index={4} aria-invalid />
              <InputOTPSlot index={5} aria-invalid />
            </InputOTPGroup>
          </InputOTP>
        </div>
      </div>
    )
  },
}
