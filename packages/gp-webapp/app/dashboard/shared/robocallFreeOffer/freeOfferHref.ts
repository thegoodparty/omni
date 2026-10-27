import { ROBOCALL_FREE_OFFER_VARIANT } from '@goodparty_org/contracts'
import type { ComposeSource } from 'app/dashboard/outreach/util/composeOutreachHref.util'

// Opens the robocall flow on the free offer's list. The offer is a robocall
// and nothing else, so no surface asks for a channel first. Always by
// variant, even once the list is saved: the flow resolves the saved list
// itself, and the variant is what lands the schedule on election eve.
export const freeOfferHref = (source: ComposeSource): string => {
  const params = new URLSearchParams({
    compose: 'robocall',
    source,
    recommended: ROBOCALL_FREE_OFFER_VARIANT,
  })
  return `/dashboard/outreach?${params.toString()}`
}
