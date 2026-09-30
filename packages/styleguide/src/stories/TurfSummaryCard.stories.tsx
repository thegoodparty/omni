import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { TurfSummaryCard } from 'app/dashboard/door-knocking/native/TurfSummaryCard'
import { Button } from '../components/ui/button'

// A door-knocking turf as a RECORD, drawn by two surfaces that must not
// drift: the create flow's success screen and the campaign details drawer.
// A candidate reaches the second within a tap of the first.
//
// Not the card the drawing surface uses. That one is a form — rename in
// place, colour swatches, an assignee menu, an error caption — and lives in
// the feature as `TurfCard`.
const meta: Meta<typeof TurfSummaryCard> = {
  component: TurfSummaryCard,
  title: 'Door knocking/TurfSummaryCard',
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof TurfSummaryCard>

const turf = {
  name: 'Riverside',
  color: '#2563eb',
  stopCount: 43,
  peopleCount: 98,
  loggedCount: 0,
}

export const Playground: Story = {
  args: {
    turf,
    muted: false,
    trailing: null,
    footer: null,
  },
  argTypes: {
    muted: {
      control: 'boolean',
      description:
        'Dims the dot and the name for a turf that is done or archived. Shelved is a state, not a deletion.',
    },
    trailing: {
      control: false,
      description:
        'Top right of the name row. The details drawer puts the assignee menu here while a turf is live, and the status word once it is not.',
    },
    footer: {
      control: false,
      description:
        'The washed half under the full-bleed rule. Omitted entirely when there is nothing to do, rather than rendered empty with a dead control.',
    },
    turf: { table: { disable: true } },
  },
}

// The percentage is of PEOPLE logged, which is the population the left-hand
// figure ends with. A freshly created campaign sits at 0% by definition, and
// that is the honest reading rather than a reason to hide the bar.
export const Progress: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-2">
      <TurfSummaryCard turf={turf} trailing={null} footer={null} />
      <TurfSummaryCard
        turf={{ ...turf, name: 'Elm & 5th', loggedCount: 41 }}
        trailing={null}
        footer={null}
      />
      <TurfSummaryCard
        turf={{
          ...turf,
          name: 'Ward 4',
          color: '#15803d',
          loggedCount: 98,
        }}
        trailing={null}
        footer={null}
      />
    </div>
  ),
}

// Both surfaces, side by side, which is the whole reason this component
// exists — and the reason both slots are REQUIRED rather than optional. The
// success screen shipped without the assignee control because the slot was
// optional and it simply did not pass one; a typecheck catches that where a
// screenshot comparison did not.
export const Surfaces: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.03em] text-muted-foreground">
          Create flow, success screen
        </p>
        <TurfSummaryCard
          turf={turf}
          trailing={
            <span className="shrink-0 px-1 text-sm font-normal text-muted-foreground">
              Unassigned
            </span>
          }
          // One control, right-aligned by `ml-auto`. The drawer's left slot
          // is Mark as done, which on a turf created seconds ago is an
          // action with nothing behind it.
          footer={
            <Button size="small" className="ml-auto">
              Start knocking
            </Button>
          }
        />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.03em] text-muted-foreground">
          Campaign details drawer
        </p>
        <TurfSummaryCard
          turf={{ ...turf, loggedCount: 41 }}
          trailing={
            <span className="shrink-0 px-1 text-sm font-normal text-muted-foreground">
              Alex Rivera
            </span>
          }
          footer={
            <>
              <Button variant="ghost" size="small">
                Mark as done
              </Button>
              <Button size="small">Continue knocking</Button>
            </>
          }
        />
      </div>
    </div>
  ),
}

// A turf that is finished or shelved keeps its figures and loses the footer.
// The status word takes the slot the assignee menu had, so the top right
// carries one thing either way.
export const Muted: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <TurfSummaryCard
      turf={{ ...turf, loggedCount: 98 }}
      muted
      footer={null}
      trailing={
        <span className="shrink-0 text-sm font-medium text-muted-foreground">
          Done
        </span>
      }
    />
  ),
}

// `stopCount` arrived after these surfaces did, so a preview deploy talking
// to an API a release behind genuinely has it absent. People alone is the
// honest degradation — doors is a DIFFERENT number, so printing it under the
// word "stops" would be a plausible-looking lie.
export const WithoutStopCount: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <TurfSummaryCard
      turf={{
        ...turf,
        stopCount: undefined as unknown as number,
        loggedCount: 12,
      }}
      trailing={null}
      footer={null}
    />
  ),
}
