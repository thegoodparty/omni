import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '../components/ui/breadcrumb'
import { BreadcrumbNav } from '../components/ui/breadcrumb-nav'

const meta: Meta<typeof BreadcrumbNav> = {
  title: 'Components/Breadcrumb',
  component: BreadcrumbNav,
  tags: ['autodocs'],
  argTypes: {
    items: { table: { disable: true } },
  },
}

export default meta

type PlaygroundArgs = {
  crumbCount: number
  collapsible: boolean
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    crumbCount: 5,
    collapsible: true,
  },
  argTypes: {
    crumbCount: {
      control: { type: 'number', min: 1, max: 8, step: 1 },
      description: 'Total number of crumbs including the current page.',
    },
    collapsible: {
      control: 'boolean',
      description:
        'When true, middle items collapse to an ellipsis whenever the trail overflows its container — on any screen size. Resize the canvas to see it in action.',
    },
  },
  render: ({ crumbCount, collapsible }) => {
    const parentLabels = [
      'Dashboard',
      'Campaign Manager',
      'Voter Outreach Programs',
      'District 4 Door Knocking Initiative',
      'Volunteer Coordination',
      'Weekly Schedule',
      'Sunday Canvassing',
    ]
    const clampedCount = Math.max(
      1,
      Math.min(crumbCount, parentLabels.length + 1),
    )
    const parents = parentLabels.slice(0, clampedCount - 1)
    const items = [
      ...parents.map((label) => ({ label, href: '#' })),
      { label: 'Q2 Voter Contact Summary' },
    ]
    return <BreadcrumbNav items={items} collapsible={collapsible} />
  },
}

export const Default: StoryObj<typeof BreadcrumbNav> = {
  render: () => (
    <BreadcrumbNav
      items={[
        { label: 'Dashboard', href: '#' },
        { label: 'Polls', href: '#' },
        { label: 'Q2 Voter Survey' },
      ]}
    />
  ),
}

export const WithEllipsis: StoryObj<typeof Breadcrumb> = {
  render: () => (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#">Dashboard</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbEllipsis />
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="#">Polls</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>Q2 Voter Survey</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  ),
}
