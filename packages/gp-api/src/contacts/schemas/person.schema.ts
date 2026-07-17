import type { Person, PeopleListResponse } from '@goodparty_org/contracts'

// PersonOutput is the name gp-api's contacts code uses; the shape now lives in
// @goodparty_org/contracts as Person (shared with gp-webapp) to avoid drift.
//
// politicalParty is optional on this shape because ContactsService strips it
// for every `eo-` (Serve) organization at the single choke point shared by
// list, detail, and typeahead (findContacts/findPerson), and rejects any
// request whose filter resolves to a party condition with a 400 (list, count,
// download) — see ContactsService (ENG-10696). This is now a server-enforced
// rule, not just the frontend's hidePoliticalParty display gate; the frontend
// gate stays as the UX layer on top of it. Win responses are unaffected.
export type PersonOutput = Person

export type { PeopleListResponse }
