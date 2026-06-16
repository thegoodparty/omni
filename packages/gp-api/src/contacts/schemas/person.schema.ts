import type { Person, PeopleListResponse } from '@goodparty_org/contracts'

// PersonOutput is the name gp-api's contacts code uses; the shape now lives in
// @goodparty_org/contracts as Person (shared with gp-webapp) to avoid drift.
export type PersonOutput = Person

export type { PeopleListResponse }
