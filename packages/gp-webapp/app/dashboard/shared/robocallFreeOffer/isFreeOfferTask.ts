import { ROBOCALL_FREE_OFFER_VARIANT } from '@goodparty_org/contracts'

// The free robocall offer's plan task. Tracker rows carry no catalog id, and
// the task's link is the one thing about it that names the offer: it opens
// the robocall flow on the offer's list.
export const isFreeOfferTaskHref = (href: string | null | undefined): boolean =>
  !!href && href.includes(`recommended=${ROBOCALL_FREE_OFFER_VARIANT}`)
