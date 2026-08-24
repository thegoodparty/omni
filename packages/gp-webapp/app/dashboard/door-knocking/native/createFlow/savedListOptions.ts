import type { SegmentResponse } from 'app/dashboard/contacts/crm/shared/contacts-types'
import type { DecodedPack } from '../packDecoder'
import { runFilter } from '../filterEngine'
import { savedListFilterKeys } from '../savedListFilters'
import { filtersToDimSelections } from './voterFilterPreview'

export interface SavedListOption {
  id: number
  name: string
  // District-wide households the list's own filters keep. Null until the pack
  // has decoded — the row still renders, without the parenthesised count,
  // because a list you can't pick is worse than a count that arrives late.
  households: number | null
  // The list's selections re-expanded into the boolean option keys the filter
  // pills speak, so picking a list seeds the draft with exactly what the CRM
  // saved. Shared with the landing rail and the details drawer through
  // `savedListFilterKeys`, so the three cannot re-expand a list differently.
  filters: Record<string, boolean>
}

export interface AudienceOptions {
  allContactsHouseholds: number | null
  lists: SavedListOption[]
}

// The who step's list picker, counts included. The counts are the SAME
// quantity and the SAME derivation as the step's own `districtHouseholds` —
// `runFilter().households` over the pack — rather than a second one that could
// disagree with the number in the Continue button once a list is picked. They
// are district-wide and un-softened for the reason the district figure always
// is: the polygon does not exist yet, and the pack's only caveat here is that
// it holds rooftop-geocoded rows.
//
// One `runFilter` pass per list, memoised by the caller on the pack and the
// lists. That is the price of the parenthesised counts the canvas asks for;
// nothing here re-runs while the candidate is toggling pills, because the
// draft is not an input.
export const audienceOptions = (
  lists: SegmentResponse[] | undefined,
  pack: DecodedPack | null,
): AudienceOptions => ({
  allContactsHouseholds: pack
    ? (runFilter(pack, new Map()).households ?? null)
    : null,
  lists: (lists ?? [])
    .filter((list): list is SegmentResponse & { name: string } =>
      Boolean(list.name),
    )
    .map((list) => {
      const filters = savedListFilterKeys(list)
      return {
        id: list.id,
        name: list.name,
        households: pack
          ? (runFilter(pack, filtersToDimSelections(filters, pack.manifest))
              .households ?? null)
          : null,
        filters,
      }
    }),
})
