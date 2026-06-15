import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useArgs } from 'storybook/preview-api'
import { Switch, SwitchLabel } from '../components/ui/switch'

const meta: Meta<typeof Switch> = {
  title: 'Components/Switch',
  component: Switch,
  tags: ['autodocs'],
  argTypes: {
    disabled: {
      control: 'boolean',
      description: 'Disable the switch so it cannot be toggled.',
    },
    checked: {
      control: 'boolean',
      description: 'Controlled checked state.',
    },
    autoFocus: {
      table: { disable: true },
    },
    showLabel: {
      control: 'boolean',
      description: 'Story-only — show the switch with a label.',
    },
    showDescription: {
      control: 'boolean',
      description:
        'Story-only — show secondary description text below the label. Only applies when label is shown.',
    },
    side: {
      control: { type: 'inline-radio' },
      options: ['left', 'right'],
      description:
        'Side the switch appears on. Only applies when label is shown.',
    },
  },
}

export default meta
type Story = StoryObj<typeof Switch>

const LABEL = 'Notifications'
const DESCRIPTION = 'Receive email notifications for important updates.'

export const Playground: Story = {
  args: {
    checked: false,
    disabled: false,
    showLabel: false,
    showDescription: false,
    side: 'left',
  },
  render: ({
    checked,
    disabled,
    showLabel,
    showDescription,
    side,
  }: React.ComponentProps<typeof Switch> & {
    showLabel?: boolean
    showDescription?: boolean
    side?: 'left' | 'right'
  }) => {
    const [, updateArgs] = useArgs()
    if (showLabel) {
      return (
        <div className="max-w-sm">
          <SwitchLabel
            id="pg"
            label={LABEL}
            description={showDescription ? DESCRIPTION : undefined}
            side={side}
            checked={checked}
            disabled={disabled}
            onCheckedChange={(next) => updateArgs({ checked: next })}
          />
        </div>
      )
    }
    return (
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => updateArgs({ checked: next })}
      />
    )
  },
}

export const Default: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Switch
        </p>
        <div className="flex items-center gap-4">
          <Switch />
          <Switch defaultChecked />
        </div>
      </section>
      <section className="flex max-w-sm flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          With label
        </p>
        <SwitchLabel id="d-label-off" label={LABEL} />
        <SwitchLabel id="d-label-on" label={LABEL} defaultChecked />
      </section>
      <section className="flex max-w-sm flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          With label and description
        </p>
        <SwitchLabel id="d-desc-off" label={LABEL} description={DESCRIPTION} />
        <SwitchLabel
          id="d-desc-on"
          label={LABEL}
          description={DESCRIPTION}
          defaultChecked
        />
      </section>
    </div>
  ),
}

export const Disabled: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Switch
        </p>
        <div className="flex items-center gap-4">
          <Switch disabled />
          <Switch disabled defaultChecked />
        </div>
      </section>
      <section className="flex max-w-sm flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          With label
        </p>
        <SwitchLabel id="dis-label-off" label={LABEL} disabled />
        <SwitchLabel id="dis-label-on" label={LABEL} disabled defaultChecked />
      </section>
      <section className="flex max-w-sm flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          With label and description
        </p>
        <SwitchLabel
          id="dis-desc-off"
          label={LABEL}
          description={DESCRIPTION}
          disabled
        />
        <SwitchLabel
          id="dis-desc-on"
          label={LABEL}
          description={DESCRIPTION}
          disabled
          defaultChecked
        />
      </section>
    </div>
  ),
}

export const Focused: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Switch
        </p>
        <div className="flex items-center gap-4">
          <Switch className="ring-[3px] ring-components-input-focus" />
          <Switch
            defaultChecked
            className="ring-[3px] ring-components-input-focus"
          />
        </div>
      </section>
      <section className="flex max-w-sm flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          With label
        </p>
        <SwitchLabel
          id="foc-label-off"
          label={LABEL}
          switchClassName="ring-[3px] ring-components-input-focus"
        />
        <SwitchLabel
          id="foc-label-on"
          label={LABEL}
          defaultChecked
          switchClassName="ring-[3px] ring-components-input-focus"
        />
      </section>
      <section className="flex max-w-sm flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          With label and description
        </p>
        <SwitchLabel
          id="foc-desc-off"
          label={LABEL}
          description={DESCRIPTION}
          switchClassName="ring-[3px] ring-components-input-focus"
        />
        <SwitchLabel
          id="foc-desc-on"
          label={LABEL}
          description={DESCRIPTION}
          defaultChecked
          switchClassName="ring-[3px] ring-components-input-focus"
        />
      </section>
    </div>
  ),
}
