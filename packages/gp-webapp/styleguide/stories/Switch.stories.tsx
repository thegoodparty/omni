import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useArgs } from 'storybook/preview-api'
import { Switch, SwitchLabel, SwitchBox } from '../components/ui/switch'

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
    showFocusRing: {
      control: 'boolean',
      description:
        'Preview focus ring. Story-only — forces the focus ring visible so you can inspect it without keyboard navigation.',
    },
    label: {
      control: 'text',
      description: 'Label text (SwitchLabel and SwitchBox only).',
    },
    description: {
      control: 'text',
      description:
        'Description text below the label (SwitchLabel and SwitchBox only).',
    },
    side: {
      control: { type: 'inline-radio' },
      options: ['left', 'right'],
      description:
        'Side the switch appears on (SwitchLabel and SwitchBox only).',
    },
  },
}

export default meta
type Story = StoryObj<typeof Switch>

// ---------------------------------------------------------------------------
// Switch (bare)
// ---------------------------------------------------------------------------

export const Playground: Story = {
  args: {
    checked: false,
    disabled: false,
    showFocusRing: false,
    label: 'Notifications',
    description: 'Receive email notifications for important updates.',
    side: 'left',
  },
  render: ({
    checked,
    disabled,
    showFocusRing,
    label,
    description,
    side,
  }: React.ComponentProps<typeof Switch> & {
    showFocusRing?: boolean
    label?: string
    description?: string
    side?: 'left' | 'right'
  }) => {
    const [, updateArgs] = useArgs()
    const focusClass = showFocusRing
      ? checked
        ? 'ring-[3px] ring-components-input-focus'
        : 'ring-[3px] ring-transparent'
      : undefined
    return (
      <div className="flex max-w-sm flex-col gap-4">
        <Switch
          checked={checked}
          disabled={disabled}
          className={focusClass}
          onCheckedChange={(next) => updateArgs({ checked: next })}
        />
        <SwitchLabel
          id="pg-label"
          label={label ?? 'Notifications'}
          description={description}
          side={side}
          checked={checked}
          disabled={disabled}
          switchClassName={focusClass}
          onCheckedChange={(next) => updateArgs({ checked: next })}
        />
        <SwitchBox
          id="pg-box"
          label={label ?? 'Notifications'}
          description={description}
          side={side}
          checked={checked}
          disabled={disabled}
          switchClassName={focusClass}
          onCheckedChange={(next) => updateArgs({ checked: next })}
        />
      </div>
    )
  },
}

export const Focused: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex max-w-sm flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Focus ring only appears in the On state. SwitchBox focus is shown
        natively via keyboard navigation.
      </p>
      <Switch
        id="focus-bare"
        defaultChecked
        className="ring-[3px] ring-components-input-focus"
      />
      <SwitchLabel
        id="focus-label"
        label="Notifications"
        description="Receive email notifications for important updates."
        defaultChecked
        switchClassName="ring-[3px] ring-components-input-focus"
      />
    </div>
  ),
}

export const Disabled: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex max-w-sm flex-col gap-4">
      <div className="flex gap-4">
        <Switch id="disabled-off" disabled />
        <Switch id="disabled-on" disabled defaultChecked />
      </div>
      <SwitchLabel
        id="disabled-label-off"
        label="Notifications"
        description="Receive email notifications for important updates."
        disabled
      />
      <SwitchLabel
        id="disabled-label-on"
        label="Notifications"
        description="Receive email notifications for important updates."
        disabled
        defaultChecked
      />
      <SwitchBox
        id="disabled-box-off"
        label="Dark mode"
        description="Switch between light and dark themes."
        disabled
      />
      <SwitchBox
        id="disabled-box-on"
        label="Dark mode"
        description="Switch between light and dark themes."
        disabled
        defaultChecked
      />
    </div>
  ),
}

// ---------------------------------------------------------------------------
// SwitchLabel
// ---------------------------------------------------------------------------

export const WithLabel: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex max-w-sm flex-col gap-4">
      <SwitchLabel
        id="wl-with-desc-off"
        label="Notifications"
        description="Receive email notifications for important updates."
      />
      <SwitchLabel
        id="wl-with-desc-on"
        label="Notifications"
        description="Receive email notifications for important updates."
        defaultChecked
      />
      <SwitchLabel id="wl-no-desc-off" label="Airplane mode" />
      <SwitchLabel id="wl-no-desc-on" label="Airplane mode" defaultChecked />
      <SwitchLabel
        id="wl-no-desc-right-off"
        label="Airplane mode"
        side="right"
      />
      <SwitchLabel
        id="wl-no-desc-right-on"
        label="Airplane mode"
        side="right"
        defaultChecked
      />
      <SwitchLabel
        id="wl-right-off"
        label="Notifications"
        description="Receive email notifications for important updates."
        side="right"
      />
      <SwitchLabel
        id="wl-right-on"
        label="Notifications"
        description="Receive email notifications for important updates."
        side="right"
        defaultChecked
      />
      <SwitchLabel
        id="wl-disabled-off"
        label="Notifications"
        description="Receive email notifications for important updates."
        disabled
      />
      <SwitchLabel
        id="wl-disabled-on"
        label="Notifications"
        description="Receive email notifications for important updates."
        disabled
        defaultChecked
      />
      <SwitchLabel
        id="wl-disabled-right-off"
        label="Notifications"
        description="Receive email notifications for important updates."
        side="right"
        disabled
      />
      <SwitchLabel
        id="wl-disabled-right-on"
        label="Notifications"
        description="Receive email notifications for important updates."
        side="right"
        disabled
        defaultChecked
      />
    </div>
  ),
}

// ---------------------------------------------------------------------------
// SwitchBox
// ---------------------------------------------------------------------------

export const WithBox: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex max-w-sm flex-col gap-4">
      <SwitchBox
        id="wb-with-desc-off"
        label="Dark mode"
        description="Switch between light and dark themes."
      />
      <SwitchBox
        id="wb-with-desc-on"
        label="Dark mode"
        description="Switch between light and dark themes."
        defaultChecked
      />
      <SwitchBox id="wb-no-desc-off" label="Dark mode" />
      <SwitchBox id="wb-no-desc-on" label="Dark mode" defaultChecked />
      <SwitchBox id="wb-no-desc-right-off" label="Dark mode" side="right" />
      <SwitchBox
        id="wb-no-desc-right-on"
        label="Dark mode"
        side="right"
        defaultChecked
      />
      <SwitchBox
        id="wb-right-off"
        label="Dark mode"
        description="Switch between light and dark themes."
        side="right"
      />
      <SwitchBox
        id="wb-right-on"
        label="Dark mode"
        description="Switch between light and dark themes."
        side="right"
        defaultChecked
      />
      <SwitchBox
        id="wb-disabled-off"
        label="Dark mode"
        description="Switch between light and dark themes."
        disabled
      />
      <SwitchBox
        id="wb-disabled-on"
        label="Dark mode"
        description="Switch between light and dark themes."
        disabled
        defaultChecked
      />
      <SwitchBox
        id="wb-disabled-right-off"
        label="Dark mode"
        description="Switch between light and dark themes."
        side="right"
        disabled
      />
      <SwitchBox
        id="wb-disabled-right-on"
        label="Dark mode"
        description="Switch between light and dark themes."
        side="right"
        disabled
        defaultChecked
      />
    </div>
  ),
}
