import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useArgs } from 'storybook/preview-api'
import {
  RadioCardItem,
  RadioGroup,
  RadioGroupItem,
  RadioGroupItemLabel,
} from '../components/ui/radio-group'
import { Label } from '../components/ui/label'

const meta: Meta<typeof RadioGroup> = {
  title: 'Components/RadioGroup',
  component: RadioGroup,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof RadioGroup>

type PlaygroundArgs = {
  value: string
  disabled: boolean
  showDescription: boolean
}

const DESCRIPTION = 'This is a radio description.'

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    value: 'comfortable',
    disabled: false,
    showDescription: false,
  },
  argTypes: {
    value: {
      control: 'select',
      options: ['default', 'comfortable', 'compact'],
      description: 'Controlled selection.',
    },
    disabled: {
      control: 'boolean',
      description: 'Disable every item in the group.',
    },
    showDescription: {
      control: 'boolean',
      description: 'Story-only — show description text below each label.',
    },
  },
  render: ({ value, disabled, showDescription }) => {
    const [, updateArgs] = useArgs()
    return (
      <RadioGroup
        value={value}
        onValueChange={(next) => updateArgs({ value: next })}
        disabled={disabled}
      >
        {['default', 'comfortable', 'compact'].map((option) => (
          <RadioGroupItemLabel
            key={option}
            value={option}
            id={`playground-${option}`}
            label={option.charAt(0).toUpperCase() + option.slice(1)}
            description={showDescription ? DESCRIPTION : undefined}
          />
        ))}
      </RadioGroup>
    )
  },
}

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Default
        </p>
        <RadioGroup defaultValue="option-1">
          <RadioGroupItemLabel
            value="option-1"
            id="v-option-1"
            label="Option 1"
          />
          <RadioGroupItemLabel
            value="option-2"
            id="v-option-2"
            label="Option 2"
          />
        </RadioGroup>
      </section>

      <section className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          With description
        </p>
        <RadioGroup defaultValue="card">
          <RadioGroupItemLabel
            value="card"
            id="v-card"
            label="Card"
            description="Pay with your credit card."
          />
          <RadioGroupItemLabel
            value="paypal"
            id="v-paypal"
            label="PayPal"
            description="Pay with your PayPal account."
          />
        </RadioGroup>
      </section>

      <section className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Card
        </p>
        <RadioGroup defaultValue="v-card-1">
          <RadioCardItem
            value="v-card-1"
            id="v-card-1"
            title="Radio Button Text"
            description="This is a radio description."
          />
          <RadioCardItem
            value="v-card-2"
            id="v-card-2"
            title="Radio Button Text"
            description="This is a radio description."
          />
        </RadioGroup>
      </section>
    </div>
  ),
}

export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Default
        </p>
        <div className="flex gap-8">
          <RadioGroup>
            <RadioGroupItemLabel value="s-off" id="s-off" label="Unchecked" />
          </RadioGroup>
          <RadioGroup value="s-on">
            <RadioGroupItemLabel value="s-on" id="s-on" label="Checked" />
          </RadioGroup>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Focused
        </p>
        <div className="flex gap-8">
          <RadioGroup>
            <div className="flex items-center gap-2">
              <RadioGroupItem
                value="foc-off"
                id="foc-off"
                className="ring-[3px] ring-primary-focus"
              />
              <Label htmlFor="foc-off" className="font-normal text-foreground">
                Unchecked
              </Label>
            </div>
          </RadioGroup>
          <RadioGroup value="foc-on">
            <div className="flex items-center gap-2">
              <RadioGroupItem
                value="foc-on"
                id="foc-on"
                className="ring-[3px] ring-primary-focus"
              />
              <Label htmlFor="foc-on" className="font-normal text-foreground">
                Checked
              </Label>
            </div>
          </RadioGroup>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Group disabled
        </p>
        <RadioGroup defaultValue="s1-option-1" disabled>
          <RadioGroupItemLabel
            value="s1-option-1"
            id="s1-option-1"
            label="Option 1"
          />
          <RadioGroupItemLabel
            value="s1-option-2"
            id="s1-option-2"
            label="Option 2"
          />
        </RadioGroup>
      </section>

      <section className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Item disabled
        </p>
        <RadioGroup defaultValue="s2-option-1">
          <RadioGroupItemLabel
            value="s2-option-1"
            id="s2-option-1"
            label="Option 1"
          />
          <RadioGroupItemLabel
            value="s2-option-2"
            id="s2-option-2"
            label="Option 2"
            disabled
          />
        </RadioGroup>
      </section>

      <section className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Card focused
        </p>
        <div className="flex gap-4">
          <RadioGroup>
            <Label
              htmlFor="foc-card-off"
              className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-card p-3 transition-colors"
            >
              <RadioGroupItem
                value="foc-card-off"
                id="foc-card-off"
                className="shrink-0 ring-[3px] ring-primary-focus"
              />
              <div className="flex flex-col gap-px">
                <span className="text-sm font-normal leading-5 text-foreground">
                  Radio Button Text
                </span>
                <span className="text-xs text-muted-foreground">
                  This is a radio description.
                </span>
              </div>
            </Label>
          </RadioGroup>
          <RadioGroup value="foc-card-on">
            <Label
              htmlFor="foc-card-on"
              className="flex cursor-pointer items-start gap-2 rounded-lg border border-primary bg-card p-3 ring-1 ring-primary transition-colors"
            >
              <RadioGroupItem
                value="foc-card-on"
                id="foc-card-on"
                className="shrink-0 ring-[3px] ring-primary-focus"
              />
              <div className="flex flex-col gap-px">
                <span className="text-sm font-normal leading-5 text-foreground">
                  Radio Button Text
                </span>
                <span className="text-xs text-muted-foreground">
                  This is a radio description.
                </span>
              </div>
            </Label>
          </RadioGroup>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Card disabled
        </p>
        <RadioGroup defaultValue="s3-card-1" disabled>
          <RadioCardItem
            value="s3-card-1"
            id="s3-card-1"
            title="Radio Button Text"
            description="This is a radio description."
          />
          <RadioCardItem
            value="s3-card-2"
            id="s3-card-2"
            title="Radio Button Text"
            description="This is a radio description."
          />
        </RadioGroup>
      </section>
    </div>
  ),
}
