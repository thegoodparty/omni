import type { RobocallFreeOfferResponse } from '@goodparty_org/contracts'

// The free election-eve robocall offer ended with the Nov 3, 2026 general,
// so no campaign has it and the webapp no longer asks gp-api. Every surface
// that showed the offer reads this one answer, so they all stay hidden.
export const useRobocallFreeOffer = (): {
  offer: RobocallFreeOfferResponse | null
} => ({ offer: null })
