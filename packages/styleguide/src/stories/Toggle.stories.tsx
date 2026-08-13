import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useArgs } from 'storybook/preview-api'
import { BoldIcon } from '../components/ui/icons'
import { Toggle } from '../components/ui/toggle'

const meta: Meta<typeof Toggle> = {
  title: 'Components/Toggle',
  component: Toggle,
  tags: ['autodocs'],
  argTypes: {
    asChild: { table: { disable: true } },
    defaultPressed: { table: { disable: true } },
    onPressedChange: { table: { disable: true } },
  },
}

export default meta
type Story = StoryObj<typeof Toggle>

const SectionLabel = ({ children }: { children: string }) => (
  <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
    {children}
  </p>
)

export const Playground: Story = {
  args: {
    variant: 'default',
    size: 'default',
    pressed: false,
    disabled: false,
  },
  argTypes: {
    variant: {
      control: 'inline-radio',
      options: ['default', 'outline'],
      description: 'Visual variant.',
    },
    size: {
      control: 'inline-radio',
      options: ['sm', 'default', 'lg'],
      description: 'Size of the toggle.',
    },
    pressed: {
      control: 'boolean',
      description: 'Controlled pressed state.',
    },
    disabled: {
      control: 'boolean',
      description: 'Disable the toggle.',
    },
  },
  render: ({ pressed, disabled, variant, size }) => {
    const [, updateArgs] = useArgs()
    return (
      <Toggle
        pressed={pressed}
        disabled={disabled}
        variant={variant}
        size={size}
        onPressedChange={(next) => updateArgs({ pressed: next })}
        aria-label="Toggle bold"
      >
        <BoldIcon />
      </Toggle>
    )
  },
}

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <SectionLabel>Default</SectionLabel>
        <div className="flex items-center gap-2">
          <Toggle aria-label="Toggle bold">
            <BoldIcon />
          </Toggle>
          <Toggle pressed aria-label="Toggle bold pressed">
            <BoldIcon />
          </Toggle>
          <Toggle aria-label="Toggle bold with text">Bold</Toggle>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <SectionLabel>Outline</SectionLabel>
        <div className="flex items-center gap-2">
          <Toggle variant="outline" aria-label="Toggle bold">
            <BoldIcon />
          </Toggle>
          <Toggle variant="outline" pressed aria-label="Toggle bold pressed">
            <BoldIcon />
          </Toggle>
          <Toggle variant="outline" aria-label="Toggle bold with text">
            Bold
          </Toggle>
        </div>
      </div>
    </div>
  ),
}

export const Sizes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-center gap-2">
      <Toggle size="sm" aria-label="Toggle bold small">
        <BoldIcon />
      </Toggle>
      <Toggle aria-label="Toggle bold default">
        <BoldIcon />
      </Toggle>
      <Toggle size="lg" aria-label="Toggle bold large">
        <BoldIcon />
      </Toggle>
    </div>
  ),
}

export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <SectionLabel>Off / On</SectionLabel>
        <div className="flex items-center gap-2">
          <Toggle aria-label="Toggle bold off">
            <BoldIcon />
          </Toggle>
          <Toggle pressed aria-label="Toggle bold on">
            <BoldIcon />
          </Toggle>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <SectionLabel>Disabled (off and on)</SectionLabel>
        <div className="flex items-center gap-2">
          <Toggle disabled aria-label="Toggle bold disabled off">
            <BoldIcon />
          </Toggle>
          <Toggle disabled pressed aria-label="Toggle bold disabled on">
            <BoldIcon />
          </Toggle>
        </div>
      </div>
    </div>
  ),
}

export const Anatomy: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-3">
      <SectionLabel>Icon, text, or both</SectionLabel>
      <div className="flex items-center gap-2">
        <Toggle aria-label="Toggle bold">
          <BoldIcon />
        </Toggle>
        <Toggle aria-label="Toggle bold with text">
          <BoldIcon />
          Bold
        </Toggle>
        <Toggle aria-label="Toggle bold text only">Bold</Toggle>
      </div>
    </div>
  ),
}
