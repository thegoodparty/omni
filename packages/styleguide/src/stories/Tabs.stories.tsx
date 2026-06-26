import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useArgs } from 'storybook/preview-api'
import { Code, SquarePen } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Badge } from '../components/ui/badge'

const meta: Meta<typeof Tabs> = {
  title: 'Components/Tabs',
  component: Tabs,
  tags: ['autodocs'],
  argTypes: {
    orientation: { table: { disable: true } },
    defaultValue: { table: { disable: true } },
    onValueChange: { table: { disable: true } },
    dir: { table: { disable: true } },
  },
}

export default meta
type Story = StoryObj<typeof Tabs>

const SectionLabel = ({ children }: { children: string }) => (
  <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
    {children}
  </p>
)

type PlaygroundArgs = {
  activationMode: 'automatic' | 'manual'
  value: string
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    activationMode: 'automatic',
    value: 'account',
  },
  argTypes: {
    activationMode: {
      control: 'inline-radio',
      options: ['automatic', 'manual'],
      description:
        'Automatic activates a tab when it receives focus; manual requires Enter or Space.',
    },
    value: {
      control: 'select',
      options: ['account', 'password'],
      description: 'Controlled active tab.',
    },
  },
  render: ({ activationMode, value }) => {
    const [, updateArgs] = useArgs()
    return (
      <Tabs
        activationMode={activationMode}
        value={value}
        onValueChange={(next) => updateArgs({ value: next })}
        className="w-[400px]"
      >
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="password">Password</TabsTrigger>
        </TabsList>
        <TabsContent value="account">
          <div className="space-y-4">
            <h4 className="text-sm font-medium">Account Settings</h4>
            <p className="text-sm text-muted-foreground">
              Make changes to your account settings and set your preferences.
            </p>
          </div>
        </TabsContent>
        <TabsContent value="password">
          <div className="space-y-4">
            <h4 className="text-sm font-medium">Password Settings</h4>
            <p className="text-sm text-muted-foreground">
              Change your password and manage your security settings.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    )
  },
}

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <SectionLabel>Text only</SectionLabel>
        <Tabs defaultValue="account" className="w-[360px]">
          <TabsList>
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="password">Password</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-col gap-3">
        <SectionLabel>With icons</SectionLabel>
        <Tabs defaultValue="preview" className="w-[360px]">
          <TabsList>
            <TabsTrigger value="preview">
              <SquarePen />
              Preview
            </TabsTrigger>
            <TabsTrigger value="code">
              <Code />
              Code
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-col gap-3">
        <SectionLabel>With trailing badge</SectionLabel>
        <Tabs defaultValue="billing" className="w-[360px]">
          <TabsList>
            <TabsTrigger value="billing">Billing</TabsTrigger>
            <TabsTrigger value="notifications">
              Notifications
              <Badge shape="pill">3</Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-col gap-3">
        <SectionLabel>
          Scrolls when triggers exceed the width (active scrolls into view)
        </SectionLabel>
        <Tabs defaultValue="notifications" className="w-[280px]">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  ),
}

export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <SectionLabel>Default</SectionLabel>
        <Tabs defaultValue="account" className="w-[360px]">
          <TabsList>
            <TabsTrigger value="account">Active</TabsTrigger>
            <TabsTrigger value="password">Inactive</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-col gap-3">
        <SectionLabel>Focused (tab to focus a trigger)</SectionLabel>
        <Tabs defaultValue="account" className="w-[360px]">
          <TabsList>
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="password">Password</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-col gap-3">
        <SectionLabel>Disabled</SectionLabel>
        <Tabs defaultValue="active" className="w-[360px]">
          <TabsList>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="disabled" disabled>
              Disabled
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  ),
}

export const Anatomy: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Tabs defaultValue="account" className="w-[400px]">
      <TabsList>
        <TabsTrigger value="account">Active trigger</TabsTrigger>
        <TabsTrigger value="password">Inactive trigger</TabsTrigger>
      </TabsList>
      <TabsContent value="account">
        <div className="space-y-1">
          <p className="text-sm font-medium">Content panel</p>
          <p className="text-sm text-muted-foreground">
            The list holds the triggers; each trigger reveals its matching
            content panel below.
          </p>
        </div>
      </TabsContent>
      <TabsContent value="password">
        <p className="text-sm text-muted-foreground">Password content panel.</p>
      </TabsContent>
    </Tabs>
  ),
}
