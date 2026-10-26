import {
  PRICE_PER_ROBOCALL_TENTH_CENTS,
  ROBOCALL_NUMBER_FEE_CENTS,
} from '@/shared/util/robocallPricing.util'

// The free election-eve robocall offer for the Nov 3, 2026 general.

// The Amplitude flag. A kill switch only: it is rolled out to everyone and
// gp-api decides eligibility, because none of Pro, election date or Win ICP
// reaches Amplitude reliably.
export const ROBOCALL_FREE_OFFER_FLAG = 'robocall-free-offer'

// Names this experiment's rows in robocall_experiment_precinct and its
// promotion codes' Stripe metadata.
export const ROBOCALL_FREE_OFFER_EXPERIMENT_KEY = 'robocall-free-offer-2026-11'

export const ROBOCALL_FREE_OFFER_ELECTION_DATE = '2026-11-03'

// Arms on the campaign's campaign_experiment_assignment row. The campaign is
// not randomized (its precincts are): `offered` means gp-api found it
// eligible and assigned its precincts, `withdrawn` that its district came out
// with no treatment precinct or no treatment landline to call.
export const ROBOCALL_FREE_OFFER_ARMS = {
  offered: 'offered',
  withdrawn: 'withdrawn',
} as const

export const PRECINCT_ARMS = {
  treatment: 'treatment',
  control: 'control',
} as const

// A district needs this many known precincts for a treatment/control split
// to mean anything. The Unknown bucket never counts.
export const MIN_KNOWN_PRECINCTS = 4

// The Stripe coupon's amount_off, in cents. Must match the coupon named by
// ROBOCALL_FREE_OFFER_COUPON_ID; used only to tell the candidate roughly how
// many calls the offer covers without a Stripe round-trip.
export const ROBOCALL_FREE_OFFER_CAP_CENTS = 40_000

// The calls the cap pays for once the run's flat number fee is taken out
// (8,844 at 4.5 cents a call).
export const ROBOCALL_FREE_OFFER_COVERED_CALLS = Math.floor(
  ((ROBOCALL_FREE_OFFER_CAP_CENTS - ROBOCALL_NUMBER_FEE_CENTS) * 10) /
    PRICE_PER_ROBOCALL_TENTH_CENTS,
)

export const ROBOCALL_FREE_OFFER_CODE_PREFIX = 'GPOFFER-'

// The plan task the invite script adds. Tracker rows carry no catalog id, so
// the title is how the task is found again to complete it. Same words as the
// webapp's FREE_OFFER_TITLE.
export const ROBOCALL_FREE_OFFER_TASK_TITLE =
  'Send a free promotional robocall to landline voters in selected precincts'

// Serializes precinct assignment across every campaign in the experiment,
// since overlapping districts share precincts. Same key space as
// campaigns.consts.ts.
export const ROBOCALL_FREE_OFFER_ADVISORY_LOCK_KEY = 918_279
