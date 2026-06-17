import type { Person, PeopleListResponse } from '@goodparty_org/contracts'

// PersonOutput is the name gp-api's contacts code uses; the shape now lives in
// @goodparty_org/contracts as Person (shared with gp-webapp) to avoid drift.
//
// politicalParty is part of this shape for every context (Win and Serve) — the
// contacts service forwards the party filter and passes politicalParty through
// uniformly on the list, detail, and download paths. The Win/Serve
// party-visibility rule is a single frontend display concern (the contacts
// person overlay's hidePoliticalParty gate); the backend deliberately does not
// duplicate it, so the rule can't drift across paths.
export type PersonOutput = Person

export type { PeopleListResponse }
