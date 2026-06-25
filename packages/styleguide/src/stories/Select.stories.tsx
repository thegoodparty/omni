import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useArgs } from 'storybook/preview-api'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'

const meta: Meta<typeof Select> = {
  title: 'Components/Select',
  component: Select,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Select>

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
    {children}
  </p>
)

const FRUITS = ['apple', 'banana', 'blueberry', 'grapes', 'pineapple']

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

type PlaygroundArgs = {
  value: string
  disabled: boolean
  placeholder: string
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    value: '',
    disabled: false,
    placeholder: 'Select a fruit',
  },
  argTypes: {
    value: {
      control: 'select',
      options: ['', ...FRUITS],
      description: 'Controlled selection. Empty string means nothing selected.',
    },
    disabled: { control: 'boolean' },
    placeholder: { control: 'text' },
  },
  render: ({ value, disabled, placeholder }) => {
    const [, updateArgs] = useArgs()
    return (
      <Select
        value={value}
        onValueChange={(next) => updateArgs({ value: next })}
        disabled={disabled}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Fruits</SelectLabel>
            {FRUITS.map((f) => (
              <SelectItem key={f} value={f}>
                {capitalize(f)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    )
  },
}

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-6">
      <div>
        <SectionLabel>Default</SectionLabel>
        <Select>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select a fruit" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Fruits</SelectLabel>
              {FRUITS.map((f) => (
                <SelectItem key={f} value={f}>
                  {capitalize(f)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div>
        <SectionLabel>With groups</SectionLabel>
        <Select>
          <SelectTrigger className="w-[280px]">
            <SelectValue placeholder="Select a framework" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Frontend</SelectLabel>
              <SelectItem value="react">React</SelectItem>
              <SelectItem value="vue">Vue</SelectItem>
              <SelectItem value="angular">Angular</SelectItem>
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Backend</SelectLabel>
              <SelectItem value="node">Node.js</SelectItem>
              <SelectItem value="django">Django</SelectItem>
              <SelectItem value="rails">Ruby on Rails</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </div>
  ),
}

// Active and Focus are interactive pseudo-states (:focus / :focus-visible) that
// can't be forced statically, so those two rows simulate the trigger's output
// with explicit token classes. Active = mouse focus (border only). Focus =
// keyboard focus (border + ring). The real trigger applies these via
// focus:/focus-visible: variants on the same tokens.
export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-6">
      <div>
        <SectionLabel>Default (unselected)</SectionLabel>
        <Select>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {FRUITS.map((f) => (
                <SelectItem key={f} value={f}>
                  {capitalize(f)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div>
        <SectionLabel>Active (mouse)</SectionLabel>
        <Select>
          <SelectTrigger className="w-[180px] border-components-input-active">
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {FRUITS.map((f) => (
                <SelectItem key={f} value={f}>
                  {capitalize(f)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div>
        <SectionLabel>Focus (keyboard)</SectionLabel>
        <Select>
          <SelectTrigger className="w-[180px] border-components-input-active ring-[3px] ring-components-input-focus">
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {FRUITS.map((f) => (
                <SelectItem key={f} value={f}>
                  {capitalize(f)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div>
        <SectionLabel>Selected</SectionLabel>
        <Select defaultValue="apple">
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {FRUITS.map((f) => (
                <SelectItem key={f} value={f}>
                  {capitalize(f)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div>
        <SectionLabel>Disabled</SectionLabel>
        <Select disabled>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {FRUITS.map((f) => (
                <SelectItem key={f} value={f}>
                  {capitalize(f)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div>
        <SectionLabel>With disabled item</SectionLabel>
        <Select>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select a plan" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Plans</SelectLabel>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="pro">Pro</SelectItem>
              <SelectItem value="enterprise" disabled>
                Enterprise
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div>
        <SectionLabel>Error</SectionLabel>
        <div className="grid gap-1.5">
          <Select>
            <SelectTrigger className="w-[180px]" aria-invalid>
              <SelectValue placeholder="Select an option" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {FRUITS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {capitalize(f)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className="text-sm text-destructive">Please select an option.</p>
        </div>
      </div>
      <div>
        <SectionLabel>Error focused (keyboard)</SectionLabel>
        <div className="grid gap-1.5">
          <Select>
            <SelectTrigger
              className="w-[180px] ring-[3px] ring-destructive-focus"
              aria-invalid
            >
              <SelectValue placeholder="Select an option" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {FRUITS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {capitalize(f)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className="text-sm text-destructive">Please select an option.</p>
        </div>
      </div>
    </div>
  ),
}
