import { Button, ConfettiBurst, DoorOpenIcon } from '@styleguide'
import type { DoorKnockingTurf } from '@goodparty_org/contracts'
import { CHANNEL_META } from 'app/dashboard/outreach/v2/channelMeta'
import { TurfSummaryRow } from '../TurfSummaryRow'

// The flow's terminal screen. Its own component with plain props rather than
// markup inside `CreateListFlow`, because the other three outreach flows each
// end on a screen of their own and they disagree about everything — where
// close lives, whether the stepper stays up, whether `dirty` is cleared. When
// that gets unified, this should be a move rather than a rewrite.
//
// Copy follows docs/product-copy.md: rule 9 rules out congratulating anybody,
// rule 3 rules out explaining that the route gets bought at first knock. It
// says what exists and offers the things to do about it.
//
// ONE button at the bottom, and it is Done. The turfs each carry their own
// Start knocking, so a second bottom CTA competing with them is a third
// choice on a screen whose job is to confirm and get out of the way.
//
// "Done" rather than "Close" because Close is the system's word for
// dismissing a dialog and Done is the candidate's for finishing the job.
type Props = {
  // Which product's event names a row's Mark done reports under.
  isServe: boolean
  campaignName: string
  turfs: DoorKnockingTurf[]
  // The campaign's own envelope. Carried into the walk so that closing it
  // lands on this campaign's details drawer rather than back here — this
  // screen is a one-time confirmation and there is nothing to return to.
  anchorOutreachId: number | null
  onStartKnocking: (
    turf: DoorKnockingTurf,
    anchorOutreachId: number | null,
  ) => void
  // The rows render from a local snapshot of what the create just wrote, so
  // a lifecycle write inside one of them invalidates queries this screen
  // does not read. Without this the card stays live after Mark done —
  // still offering to start a walk on a turf that is already finished.
  onTurfCompleted: (turfId: number) => void
  onDone: () => void
}

export const CreateCampaignSuccess = ({
  isServe,
  campaignName,
  turfs,
  anchorOutreachId,
  onStartKnocking,
  onTurfCompleted,
  onDone,
}: Props) => {
  const doorTotal = turfs.reduce((sum, turf) => sum + turf.doorCount, 0)

  return (
    <div className="flex flex-col gap-6 py-8">
      <div className="flex flex-col items-center gap-3 text-center">
        {/* The burst bursts FROM the channel icon, because the campaign is
            what was just finished and the icon is what says so. `play` is
            true on mount and never re-flipped, so it fires once — this
            stage mounts once and nothing re-triggers it.

            The box is sized larger than the circle because the burst
            overflows its center, the same allowance the polls success
            screen makes. */}
        <div className="flex size-20 items-center justify-center">
          <ConfettiBurst play>
            {/* The channel's own mark, identical to the outreach hub's door
                knocking tile: `CHANNEL_META.doorKnocking.iconTint` on
                `ChannelCard`'s circle treatment. It was a success-green
                circle, which made the one screen that names the channel the
                one screen that did not look like it. */}
            <span
              className={`flex size-12 shrink-0 items-center justify-center rounded-full text-foreground [&_svg]:size-5 ${CHANNEL_META.doorKnocking.iconTint}`}
            >
              <DoorOpenIcon />
            </span>
          </ConfettiBurst>
        </div>
        <div>
          <h2 className="text-2xl font-semibold">Your campaign is ready</h2>
          <p className="mt-1 text-base font-medium">{campaignName}</p>
          {/* The figures they just made, as one line. Per-turf counts are on
              each row below, so this is the total and nothing else. */}
          <p className="mt-1 text-sm text-muted-foreground">
            {turfs.length} {turfs.length === 1 ? 'turf' : 'turfs'} ·{' '}
            {doorTotal.toLocaleString()} {doorTotal === 1 ? 'door' : 'doors'}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {turfs.map((turf) => (
          // The details drawer's card, not a row of its own. A candidate
          // reaches that drawer within a tap of this screen, and a turf that
          // changed shape between the two read as a different object. The
          // bar sits at 0% here by definition, which is the honest reading
          // of a campaign one second old rather than a reason to hide it.
          // The drawer's own row, not a second arrangement of the same
          // parts. A candidate reaches that drawer within a tap of this
          // screen, so everything but the primary press is identical —
          // including Mark done, which is theirs to reach here too.
          <TurfSummaryRow
            key={turf.id}
            isServe={isServe}
            turf={turf}
            onTurfCompleted={onTurfCompleted}
            action={
              <Button
                size="small"
                onClick={() => onStartKnocking(turf, anchorOutreachId)}
              >
                Start knocking
              </Button>
            }
          />
        ))}
      </div>

      {/* Capped and centred rather than the column's full width: at the
          sheet's 608px the full-bleed button read as a banner, and the
          turfs above it each carry their own press. */}
      <Button className="mx-auto w-full max-w-xs" onClick={onDone}>
        Done
      </Button>
    </div>
  )
}
