import * as React from 'react'
import { useArgs, useState, useEffect } from 'storybook/preview-api'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { FilterPill, FilterPillGroup } from '../components/ui/filter-pill'

const OFFICES = [
  { value: 'city-council', label: 'City Council (12)' },
  { value: 'mayor', label: 'Mayor (3)' },
  { value: 'school-board', label: 'School Board (8)' },
  { value: 'sheriff', label: 'Sheriff (2)' },
]

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
    {children}
  </p>
)

const meta: Meta<typeof FilterPillGroup> = {
  title: 'Components/FilterPill',
  component: FilterPillGroup,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof FilterPillGroup>

type PlaygroundArgs = {
  type: 'single' | 'multiple'
  value: string
  disabled: boolean
  showRemove: boolean
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    value: '',
    disabled: false,
    type: 'single',
    showRemove: false,
  },
  argTypes: {
    type: {
      control: 'select',
      options: ['single', 'multiple'],
    },
    value: {
      control: 'select',
      options: ['', ...OFFICES.map((o) => o.value)],
      if: { arg: 'type', eq: 'single' },
    },
    disabled: {
      control: 'boolean',
    },
    showRemove: {
      control: 'boolean',
    },
  },
  render: function Render({ type, value, disabled, showRemove }) {
    const [, updateArgs] = useArgs()
    const [multiValue, setMultiValue] = useState<string[]>([])
    const [pills, setPills] = useState(OFFICES)
    const isMultiple = type === 'multiple'

    useEffect(() => {
      setPills(OFFICES)
    }, [showRemove])

    return (
      <FilterPillGroup
        key={type}
        type={isMultiple ? 'multiple' : 'single'}
        disabled={disabled}
        value={isMultiple ? multiValue : value}
        onValueChange={
          isMultiple
            ? (v) => setMultiValue(v as string[])
            : (v) => updateArgs({ value: v })
        }
      >
        {pills.map((o) => (
          <FilterPill
            key={o.value}
            value={o.value}
            onRemove={
              showRemove
                ? () =>
                    setPills((prev) => prev.filter((p) => p.value !== o.value))
                : undefined
            }
          >
            {o.label}
          </FilterPill>
        ))}
      </FilterPillGroup>
    )
  },
}

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: function Render() {
    const [multiValue, setMultiValue] = useState<string[]>([])
    const [pills, setPills] = useState(OFFICES)
    return (
      <div className="flex flex-col gap-6">
        <div>
          <SectionLabel>Single selection</SectionLabel>
          <FilterPillGroup value="mayor">
            {OFFICES.map((o) => (
              <FilterPill key={o.value} value={o.value}>
                {o.label}
              </FilterPill>
            ))}
          </FilterPillGroup>
        </div>
        <div>
          <SectionLabel>Multiple selection</SectionLabel>
          <FilterPillGroup
            type="multiple"
            value={multiValue}
            onValueChange={setMultiValue}
          >
            {OFFICES.map((o) => (
              <FilterPill key={o.value} value={o.value}>
                {o.label}
              </FilterPill>
            ))}
          </FilterPillGroup>
        </div>
        <div>
          <SectionLabel>Removable</SectionLabel>
          <FilterPillGroup>
            {pills.map((o) => (
              <FilterPill
                key={o.value}
                value={o.value}
                onRemove={() =>
                  setPills((prev) => prev.filter((p) => p.value !== o.value))
                }
              >
                {o.label}
              </FilterPill>
            ))}
          </FilterPillGroup>
        </div>
        <div>
          <SectionLabel>Wrapping</SectionLabel>
          <div className="max-w-sm">
            <FilterPillGroup>
              {[
                'City Council',
                'Mayor',
                'School Board',
                'Sheriff',
                'State Senate',
                'State House',
                'County Commissioner',
                'District Attorney',
                'Treasurer',
                'Auditor',
                'Clerk',
                'Judge',
              ].map((label) => (
                <FilterPill
                  key={label}
                  value={label.toLowerCase().replaceAll(' ', '-')}
                >
                  {label}
                </FilterPill>
              ))}
            </FilterPillGroup>
          </div>
        </div>
      </div>
    )
  },
}

export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-6">
      <div>
        <SectionLabel>Default</SectionLabel>
        <FilterPillGroup>
          {OFFICES.map((o) => (
            <FilterPill key={o.value} value={o.value}>
              {o.label}
            </FilterPill>
          ))}
        </FilterPillGroup>
      </div>
      <div>
        <SectionLabel>Selected</SectionLabel>
        <FilterPillGroup value="mayor">
          {OFFICES.map((o) => (
            <FilterPill key={o.value} value={o.value}>
              {o.label}
            </FilterPill>
          ))}
        </FilterPillGroup>
      </div>
      <div>
        <SectionLabel>Disabled</SectionLabel>
        <FilterPillGroup>
          {OFFICES.map((o) => (
            <FilterPill
              key={o.value}
              value={o.value}
              disabled={o.value === 'sheriff'}
            >
              {o.label}
            </FilterPill>
          ))}
        </FilterPillGroup>
      </div>
      <div>
        <SectionLabel>All disabled</SectionLabel>
        <FilterPillGroup disabled>
          {OFFICES.map((o) => (
            <FilterPill key={o.value} value={o.value}>
              {o.label}
            </FilterPill>
          ))}
        </FilterPillGroup>
      </div>
      <div>
        <SectionLabel>Selected + disabled</SectionLabel>
        <FilterPillGroup value="mayor" disabled>
          {OFFICES.map((o) => (
            <FilterPill key={o.value} value={o.value}>
              {o.label}
            </FilterPill>
          ))}
        </FilterPillGroup>
      </div>
    </div>
  ),
}
