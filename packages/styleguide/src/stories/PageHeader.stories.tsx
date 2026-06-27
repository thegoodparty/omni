import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { MenuIcon, PlusIcon, ShareIcon } from '../components/ui/icons'
import { Button } from '../components/ui/button'
import { IconButton } from '../components/ui/icon-button'
import { SidebarProvider } from '../components/ui/sidebar'
import { PageHeader } from '../components/ui/page-header'

const meta: Meta<typeof PageHeader> = {
  component: PageHeader,
  title: 'Patterns/Page Headers',
  tags: ['autodocs'],
  argTypes: {
    leading: { table: { disable: true } },
    trailing: { table: { disable: true } },
    onBack: { table: { disable: true } },
    backHref: { table: { disable: true } },
    backLabel: { table: { disable: true } },
    subBarTrailing: { table: { disable: true } },
    subBarContent: { table: { disable: true } },
  },
  parameters: {
    layout: 'fullscreen',
    backgrounds: { disable: true },
  },
  decorators: [
    (Story) => (
      // -m-6 cancels the 1.5rem padding the global preview decorator injects
      // overflow-hidden + max-h clamps the SidebarProvider's min-h-svh in docs mode
      <div className="-m-6 bg-background overflow-hidden">
        <SidebarProvider style={{ minHeight: 'unset' }}>
          <Story />
        </SidebarProvider>
      </div>
    ),
  ],
}
export default meta

const Burger = () => (
  <IconButton variant="ghost" size="medium" aria-label="Open menu">
    <MenuIcon className="size-5" />
  </IconButton>
)

const SubBarActions = () => (
  <>
    <IconButton variant="ghost" size="small" aria-label="Share">
      <ShareIcon className="size-4" />
    </IconButton>
    <Button size="small" icon={<PlusIcon />}>
      Add note
    </Button>
  </>
)

const label = (text: string) => (
  <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide px-4 pt-4 pb-2">
    {text}
  </p>
)

type PlaygroundArgs = {
  heading: string
  showTrailing: boolean
  showBack: boolean
  showBackLabel: boolean
  showSubBarTrailing: boolean
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    heading: 'Campaign Manager',
    showTrailing: true,
    showBack: false,
    showBackLabel: false,
    showSubBarTrailing: false,
  },
  argTypes: {
    heading: { control: 'text' },
    showTrailing: {
      control: 'boolean',
      description: 'Mobile: burger trigger (lg:hidden)',
    },
    showBack: { control: 'boolean', description: 'Sub-bar: show back button' },
    showBackLabel: {
      control: 'boolean',
      description: 'Sub-bar: show label next to back arrow',
      if: { arg: 'showBack', truthy: true },
    },
    showSubBarTrailing: {
      control: 'boolean',
      description: 'Sub-bar: action buttons',
    },
  },
  render: ({
    heading,
    showTrailing,
    showBack,
    showBackLabel,
    showSubBarTrailing,
  }) => (
    <PageHeader
      heading={heading}
      trailing={showTrailing ? <Burger /> : undefined}
      onBack={showBack ? () => alert('back') : undefined}
      backLabel={showBack && showBackLabel ? 'Briefings' : undefined}
      subBarTrailing={showSubBarTrailing ? <SubBarActions /> : undefined}
    />
  ),
}

export const MainBar: StoryObj = {
  name: 'Main bar',
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-0">
      {label('Mobile — logo + title + burger')}
      <PageHeader heading="Campaign Manager" trailing={<Burger />} />
      {label('Desktop — title only')}
      <PageHeader heading="Campaign Manager" />
    </div>
  ),
}

export const SubBar: StoryObj = {
  name: 'Sub-bar',
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-0">
      {label('Back arrow only')}
      <PageHeader
        heading="Briefings"
        trailing={<Burger />}
        onBack={() => alert('back')}
      />
      {label('Back with label')}
      <PageHeader
        heading="Briefings"
        trailing={<Burger />}
        onBack={() => alert('back')}
        backLabel="Briefings"
      />
      {label('Back + actions')}
      <PageHeader
        heading="Q3 Voter Outreach Meeting"
        trailing={<Burger />}
        onBack={() => alert('back')}
        backLabel="Briefings"
        subBarTrailing={<SubBarActions />}
      />
      {label('Actions only (no back)')}
      <PageHeader
        heading="Q3 Voter Outreach Meeting"
        trailing={<Burger />}
        subBarTrailing={<SubBarActions />}
      />
    </div>
  ),
}
