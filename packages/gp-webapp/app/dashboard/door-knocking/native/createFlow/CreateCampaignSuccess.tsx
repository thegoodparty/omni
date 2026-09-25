import { Button, DoorOpenIcon } from '@styleguide'
import type { DoorKnockingTurf } from '@goodparty_org/contracts'
import { ConfettiField } from 'app/dashboard/pro-upgrade/components/ConfettiField'
import { TurfRowCard } from '../TurfRowCard'

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
  campaignName: string
  turfs: DoorKnockingTurf[]
  onStartKnocking: (turf: DoorKnockingTurf) => void
  onDone: () => void
}

export const CreateCampaignSuccess = ({
  campaignName,
  turfs,
  onStartKnocking,
  onDone,
}: Props) => {
  const doorTotal = turfs.reduce((sum, turf) => sum + turf.doorCount, 0)

  return (
    <div className="flex flex-col gap-6 py-8">
      {/* `relative` so the confetti has something to be absolute against,
          and the burst drops through the icon rather than the whole sheet —
          the campaign is what was just finished, and the icon is what says
          so. It runs once because the keyframes are `1 forwards` and this
          stage mounts once; nothing re-triggers it. */}
      <div className="relative flex flex-col items-center gap-3 text-center">
        <ConfettiField />
        {/* The house treatment for a step-completed mark: a tinted circle at
            10% with the matching foreground, same as phone banking's own
            ready screen. */}
        <span className="relative flex size-12 shrink-0 items-center justify-center rounded-full bg-success/10 text-success [&_svg]:size-6">
          <DoorOpenIcon />
        </span>
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
          <TurfRowCard
            key={turf.id}
            turf={turf}
            actions={
              <Button
                size="small"
                variant="outline"
                className="shrink-0"
                onClick={() => onStartKnocking(turf)}
              >
                Start knocking
              </Button>
            }
          />
        ))}
      </div>

      <Button onClick={onDone}>Done</Button>
    </div>
  )
}
