import { Input, Label } from '@styleguide'
import { MAX_TURF_NAME_LENGTH } from '../turfQueries'

interface NameStepProps {
  value: string
  onChange: (value: string) => void
  // District-wide, like every count before a polygon exists. The step is the
  // last place the audience can still be re-cut, so it repeats the figure the
  // who step's Continue button carried rather than making the candidate
  // remember it.
  districtHouseholds: number
}

// The conditional step 3. It appears only when the draft was cut against the
// whole contact universe — a candidate who started from a named list already
// has one, and offering to save a second copy of it under a new name is how a
// list library fills with duplicates.
//
// The copy deliberately does NOT say the list is saved here. It is written
// with the turf, by the one save path on the confirm step, so that a filter
// row can never be left behind by a flow someone abandoned halfway. The
// prototype's "Save and continue" promised the opposite; this is the same
// class of departure as the walk's `not_a_voter` follow-up — the design's
// wording, corrected for when the write actually happens.
export const NameStep = ({
  value,
  onChange,
  districtHouseholds,
}: NameStepProps) => (
  <>
    <p className="text-sm text-muted-foreground">
      These filters become a reusable voter list, saved alongside the route you
      are about to draw. Name it so you can target the same audience again.
    </p>
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor="saved-list-name"
        className="text-xs font-semibold uppercase tracking-wide"
      >
        List name
      </Label>
      <Input
        id="saved-list-name"
        autoFocus
        value={value}
        maxLength={MAX_TURF_NAME_LENGTH}
        placeholder="e.g. Homeowners in Precinct 2"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
    <p className="text-xs text-muted-foreground">
      <span className="font-semibold tabular-nums text-foreground">
        {districtHouseholds.toLocaleString()}
      </span>{' '}
      matching households across your district.
    </p>
  </>
)
