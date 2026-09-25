import { Button, Card, DoorOpenIcon } from '@styleguide'
import type { DoorKnockingTurf } from '@goodparty_org/contracts'

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
// "Done" rather than "Close": every turf on screen offers Start knocking, so
// the bottom secondary means "not right now", and Close is the system's word
// for dismissing a dialog where Done is the candidate's for finishing the
// job.
type Props = {
  campaignName: string
  turfs: DoorKnockingTurf[]
  onStartKnocking: (turf: DoorKnockingTurf) => void
  onViewCampaign: () => void
  onDone: () => void
}

export const CreateCampaignSuccess = ({
  campaignName,
  turfs,
  onStartKnocking,
  onViewCampaign,
  onDone,
}: Props) => {
  const doorTotal = turfs.reduce((sum, turf) => sum + turf.doorCount, 0)

  return (
    <div className="flex flex-col gap-6 py-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-tertiary-dark">
          <DoorOpenIcon className="size-7 text-tertiary-foreground" />
        </span>
        <div>
          <h2 className="text-2xl font-semibold">Your campaign is ready</h2>
          <p className="mt-1 text-base font-medium">{campaignName}</p>
          {/* The figures they just made, as one line. Per-turf doors are on
              each row below, so this is the total and nothing else. */}
          <p className="mt-1 text-sm text-muted-foreground">
            {turfs.length} {turfs.length === 1 ? 'turf' : 'turfs'} ·{' '}
            {doorTotal} {doorTotal === 1 ? 'door' : 'doors'}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {turfs.map((turf) => (
          <Card key={turf.id} className="flex items-center gap-3 p-4">
            <span
              aria-hidden
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: turf.color }}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{turf.name}</p>
              <p className="text-sm text-muted-foreground">
                {turf.doorCount} {turf.doorCount === 1 ? 'door' : 'doors'} ·{' '}
                {turf.peopleCount}{' '}
                {turf.peopleCount === 1 ? 'person' : 'people'}
              </p>
            </div>
            <Button
              size="small"
              variant="outline"
              onClick={() => onStartKnocking(turf)}
            >
              Start knocking
            </Button>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <Button onClick={onViewCampaign}>View campaign</Button>
        <Button variant="outline" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}
