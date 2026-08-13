import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { ReactNode } from 'react'
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
} from '../components/ui/icons'
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group'

const meta: Meta<typeof ToggleGroup> = {
  title: 'Components/Toggle Group',
  component: ToggleGroup,
  tags: ['autodocs'],
  argTypes: {
    type: { table: { disable: true } },
    value: { table: { disable: true } },
    defaultValue: { table: { disable: true } },
    onValueChange: { table: { disable: true } },
    asChild: { table: { disable: true } },
  },
}

export default meta
type Story = StoryObj<typeof ToggleGroup>

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
    {children}
  </p>
)

const AlignmentItems = () => (
  <>
    <ToggleGroupItem value="left" aria-label="Align left">
      <AlignLeftIcon />
    </ToggleGroupItem>
    <ToggleGroupItem value="center" aria-label="Align center">
      <AlignCenterIcon />
    </ToggleGroupItem>
    <ToggleGroupItem value="right" aria-label="Align right">
      <AlignRightIcon />
    </ToggleGroupItem>
  </>
)

type PlaygroundArgs = {
  type: 'single' | 'multiple'
  variant: 'default' | 'outline'
  size: 'sm' | 'default' | 'lg'
  disabled: boolean
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    type: 'single',
    variant: 'default',
    size: 'default',
    disabled: false,
  },
  argTypes: {
    type: {
      control: 'inline-radio',
      options: ['single', 'multiple'],
      description:
        'Single allows one selection at a time; multiple allows any number.',
    },
    variant: {
      control: 'inline-radio',
      options: ['default', 'outline'],
      description: 'Visual variant inherited by every item.',
    },
    size: {
      control: 'inline-radio',
      options: ['sm', 'default', 'lg'],
      description: 'Size inherited by every item.',
    },
    disabled: {
      control: 'boolean',
      description: 'Disable the entire group.',
    },
  },
  render: ({ type, variant, size, disabled }) =>
    type === 'multiple' ? (
      <ToggleGroup
        type="multiple"
        variant={variant}
        size={size}
        disabled={disabled}
        defaultValue={['left']}
        aria-label="Text alignment"
      >
        <AlignmentItems />
      </ToggleGroup>
    ) : (
      <ToggleGroup
        type="single"
        variant={variant}
        size={size}
        disabled={disabled}
        defaultValue="left"
        aria-label="Text alignment"
      >
        <AlignmentItems />
      </ToggleGroup>
    ),
}

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <SectionLabel>Default</SectionLabel>
        <ToggleGroup
          type="single"
          defaultValue="left"
          aria-label="Text alignment"
        >
          <AlignmentItems />
        </ToggleGroup>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>Outline</SectionLabel>
        <ToggleGroup
          type="single"
          variant="outline"
          defaultValue="all"
          aria-label="Range"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="missed">Missed</ToggleGroupItem>
        </ToggleGroup>
      </section>
    </div>
  ),
}

export const Sizes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-8">
      {(['sm', 'default', 'lg'] as const).map((size) => (
        <section key={size} className="flex flex-col gap-2">
          <SectionLabel>{size}</SectionLabel>
          <div className="flex items-center gap-6">
            <ToggleGroup
              type="single"
              size={size}
              defaultValue="left"
              aria-label="Text alignment"
            >
              <AlignmentItems />
            </ToggleGroup>
            <ToggleGroup
              type="single"
              variant="outline"
              size={size}
              defaultValue="last-24"
              aria-label="Range"
            >
              <ToggleGroupItem value="last-24">Last 24 hours</ToggleGroupItem>
              <ToggleGroupItem value="last-7">Last 7 days</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </section>
      ))}
    </div>
  ),
}

export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <SectionLabel>Default</SectionLabel>
        <div className="flex items-center gap-6">
          <ToggleGroup type="single" variant="outline" aria-label="Unselected">
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="missed">Missed</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            type="single"
            variant="outline"
            defaultValue="all"
            aria-label="Selected"
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="missed">Missed</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>Focused</SectionLabel>
        <ToggleGroup type="single" aria-label="Focused">
          <ToggleGroupItem value="left" aria-label="Align left">
            <AlignLeftIcon />
          </ToggleGroupItem>
          <ToggleGroupItem
            value="center"
            aria-label="Align center"
            className="ring-primary-focus ring-offset-background relative z-10 ring-[3px] ring-offset-2"
          >
            <AlignCenterIcon />
          </ToggleGroupItem>
          <ToggleGroupItem value="right" aria-label="Align right">
            <AlignRightIcon />
          </ToggleGroupItem>
        </ToggleGroup>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>Disabled group</SectionLabel>
        <ToggleGroup
          type="single"
          variant="outline"
          defaultValue="all"
          disabled
          aria-label="Disabled"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="missed">Missed</ToggleGroupItem>
        </ToggleGroup>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>Disabled item</SectionLabel>
        <ToggleGroup
          type="single"
          variant="outline"
          defaultValue="all"
          aria-label="Disabled item"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="missed" disabled>
            Missed
          </ToggleGroupItem>
        </ToggleGroup>
      </section>
    </div>
  ),
}
