'use client'

import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TurfSummaryRow } from 'app/dashboard/door-knocking/native/TurfSummaryRow'
import { OrganizationProvider } from '@shared/organization-picker'
import { SnackbarProvider } from '@shared/utils/Snackbar'
import { teamQueryKey } from 'app/dashboard/team/team.util'
import { Button } from '../components/ui/button'

// The BEHAVIOURAL half of a campaign's turf row: who walks it, and marking
// it done behind its confirm. `TurfSummaryCard` is the shape under it and
// has a story of its own — that one renders with no providers at all, which
// is the point of keeping the two apart.
//
// This one needs three: React Query for the roster and the assignee read,
// the organization for whose roster it is, and the snackbar the mutation
// reports through. That weight is exactly why the success screen and the
// details drawer must not each compose these parts by hand — the first
// attempt at this did, and shipped a success screen with no assignee
// control and an invented text label where the drawer has Mark done.
const ORG_SLUG = 'demo-campaign'

const turf = {
  id: 12,
  outreachId: 900,
  voterFileFilterId: 7,
  name: 'Riverside',
  color: '#2563eb',
  geoPoly: { type: 'Polygon' as const, coordinates: [] },
  stopCount: 43,
  doorCount: 51,
  knockedDoorCount: 0,
  peopleCount: 98,
  loggedCount: 0,
  routeSeconds: 900,
  completed: false,
  archivedAt: null,
  createdAt: new Date('2026-09-29T00:00:00Z'),
  updatedAt: new Date('2026-09-29T00:00:00Z'),
} as unknown as Parameters<typeof TurfSummaryRow>[0]['turf']

// Seeded rather than fetched: Storybook has no API behind it, and a roster
// is what decides whether the assignee control renders at all.
const withProviders = (Story: () => React.ReactElement) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(teamQueryKey(ORG_SLUG), [
    { id: 42, firstName: 'Alex', lastName: 'Rivera', role: 'volunteer' },
    { id: 43, firstName: 'Sam', lastName: 'Okafor', role: 'volunteer' },
  ])
  return (
    <QueryClientProvider client={client}>
      <OrganizationProvider
        initialOrganizations={
          [
            { slug: ORG_SLUG, name: 'Demo campaign' },
          ] as unknown as React.ComponentProps<
            typeof OrganizationProvider
          >['initialOrganizations']
        }
        initialSlug={ORG_SLUG}
      >
        <SnackbarProvider>
          <div className="max-w-md">
            <Story />
          </div>
        </SnackbarProvider>
      </OrganizationProvider>
    </QueryClientProvider>
  )
}

const meta: Meta<typeof TurfSummaryRow> = {
  component: TurfSummaryRow,
  title: 'Door knocking/TurfSummaryRow',
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
  decorators: [withProviders],
}
export default meta

type Story = StoryObj<typeof TurfSummaryRow>

export const Playground: Story = {
  args: {
    turf,
    action: <Button size="small">Start knocking</Button>,
  },
  argTypes: {
    action: {
      control: false,
      description:
        'The only difference between the two surfaces. The drawer deep-links into the walk; the success screen calls back into the flow it is still inside.',
    },
    turf: { table: { disable: true } },
    onOverlayOpenChange: { table: { disable: true } },
    onTurfCompleted: { table: { disable: true } },
  },
}

// Both surfaces, which is the whole reason this component exists. Only the
// primary press differs.
export const Surfaces: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.03em] text-muted-foreground">
          Create flow, success screen
        </p>
        <TurfSummaryRow
          isServe={false}
          turf={turf}
          action={<Button size="small">Start knocking</Button>}
        />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.03em] text-muted-foreground">
          Campaign details drawer
        </p>
        <TurfSummaryRow
          isServe={false}
          turf={{ ...turf, loggedCount: 41 }}
          action={<Button size="small">Continue knocking</Button>}
        />
      </div>
    </div>
  ),
}

// Press Mark done on a turf with people left unlogged and the confirm
// names how many. A fully logged turf skips it — there is nothing to warn
// about.
export const MarkDoneConfirm: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <TurfSummaryRow
      isServe={false}
      turf={{ ...turf, loggedCount: 12 }}
      action={<Button size="small">Continue knocking</Button>}
    />
  ),
}

// Done or archived: dimmed, the status word takes the assignee's slot, and
// the footer goes rather than offering a dead control.
export const Finished: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <TurfSummaryRow
      isServe={false}
      turf={{ ...turf, loggedCount: 98, completed: true }}
      action={<Button size="small">Continue knocking</Button>}
    />
  ),
}
