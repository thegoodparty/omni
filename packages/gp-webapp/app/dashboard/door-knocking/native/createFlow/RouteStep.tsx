import { DoorKnockingMode } from '@goodparty_org/contracts'
import { Checkbox, Label, RadioGroup, RadioGroupItem } from '@styleguide'
import { WALKABLE_LEG_SECONDS } from '../travelMode'

const SuggestedTag = () => (
  <span className="rounded-full border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
    Suggested
  </span>
)

const SUGGESTION_REASON: Record<DoorKnockingMode, string> = {
  walk: `Suggested because every stop is within a ${WALKABLE_LEG_SECONDS / 60}-minute walk of the next one.`,
  drive: `Suggested because at least one stop is more than a ${WALKABLE_LEG_SECONDS / 60}-minute walk from the rest, so the whole list is a drive.`,
}

interface RouteStepProps {
  mode: DoorKnockingMode
  onModeChange: (mode: DoorKnockingMode) => void
  loop: boolean
  onLoopChange: (loop: boolean) => void
  // Which mode the drawn shape's own geometry argues for, or null when there
  // is nothing to argue from yet. It only tags a radio — the selected mode is
  // the caller's, so a suggestion that resolves late cannot move a choice
  // already made.
  suggested: DoorKnockingMode | null
}

// The last step, and the only one that spends money: pressing Build route
// under it creates the list, buys the Geoapify route and freezes the doors in
// one transaction. Everything before it is client state.
//
// This was a dialog on an already-saved list (`KnockTurfDialog`) until the
// route moved to list creation, and the copy is unchanged because what it
// describes is unchanged — the same purchase, asked at the only moment it can
// now happen.
export const RouteStep = ({
  mode,
  onModeChange,
  loop,
  onLoopChange,
  suggested,
}: RouteStepProps) => (
  <div className="flex flex-col gap-5">
    <div className="flex flex-col gap-2.5">
      <Label>Travel mode</Label>
      <RadioGroup
        value={mode}
        onValueChange={(value) => onModeChange(value as DoorKnockingMode)}
        className="flex flex-col gap-2.5"
      >
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="walk" /> Walking
          {suggested === 'walk' && <SuggestedTag />}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="drive" /> Driving
          {suggested === 'drive' && <SuggestedTag />}
        </label>
      </RadioGroup>
      {suggested && (
        <p className="text-sm text-muted-foreground">
          {SUGGESTION_REASON[suggested]}
        </p>
      )}
    </div>
    <label className="flex items-center gap-2 text-sm">
      <Checkbox
        checked={loop}
        onCheckedChange={(checked) => onLoopChange(checked === true)}
      />
      End where I start (loop route)
    </label>
  </div>
)
