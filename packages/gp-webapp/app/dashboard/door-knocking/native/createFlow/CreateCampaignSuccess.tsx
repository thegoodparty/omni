import { Button } from '@styleguide'

// The flow's terminal screen. Its own component with plain props rather than
// markup inside `CreateListFlow`, because the other three outreach flows each
// end on a screen of their own and they disagree about everything — where
// close lives, whether the stepper stays up, whether `dirty` is cleared. When
// that gets unified, this should be a move rather than a rewrite.
//
// Copy follows docs/product-copy.md: rule 9 rules out congratulating anybody,
// rule 3 rules out explaining that the route gets bought later. It says what
// exists and offers the two things to do about it.
type Props = {
  campaignName: string
  turfCount: number
  doorCount: number
  onViewCampaign: () => void
  onClose: () => void
}

// Rounded, and hedged with "about", because it is the frozen door count of
// the turfs just drawn — real, but the candidate is about to see per-turf
// figures on the details page and a precise total here would invite adding
// them up.
const summary = (turfCount: number, doorCount: number) =>
  `${turfCount} ${turfCount === 1 ? 'turf' : 'turfs'} · about ${doorCount} ${
    doorCount === 1 ? 'door' : 'doors'
  }`

export const CreateCampaignSuccess = ({
  campaignName,
  turfCount,
  doorCount,
  onViewCampaign,
  onClose,
}: Props) => (
  <div className="flex flex-col items-center gap-2 py-10 text-center">
    <h2 className="text-2xl font-semibold">Your campaign is ready</h2>
    <p className="text-base font-medium">{campaignName}</p>
    <p className="text-sm text-muted-foreground">
      {summary(turfCount, doorCount)}
    </p>
    <div className="mt-8 flex w-full flex-col gap-3">
      <Button onClick={onViewCampaign}>View campaign</Button>
      <Button variant="outline" onClick={onClose}>
        Close
      </Button>
    </div>
  </div>
)
