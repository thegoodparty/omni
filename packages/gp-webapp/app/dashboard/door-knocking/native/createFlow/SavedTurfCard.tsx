import type { DoorKnockingTurf } from '@goodparty_org/contracts'
import { Card } from '@styleguide'
import { TurfAssigneeMenu } from 'app/dashboard/outreach/v2/TurfAssigneeMenu'

// A turf the campaign already holds, listed on the drawing panel when it was
// entered from the campaign's drawer to add more. It is there so the
// candidate can see what the campaign covers while they draw beside it, and
// it is not a draft: nothing on it can be deleted, renamed or recoloured
// here, because it is already a saved turf with its own envelope. Who walks
// it is the one thing it offers, through the same menu as the drawer's card,
// writing straight to that envelope.
export const SavedTurfCard = ({ turf }: { turf: DoorKnockingTurf }) => (
  <Card className="flex-row items-center gap-3 rounded-lg px-3 py-3">
    <span
      aria-hidden="true"
      className="size-3 shrink-0 rounded-full"
      style={{ backgroundColor: turf.color }}
    />
    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
      {turf.name}
    </span>
    <TurfAssigneeMenu outreachId={turf.outreachId} />
  </Card>
)
