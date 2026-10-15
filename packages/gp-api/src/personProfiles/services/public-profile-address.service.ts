import { Injectable } from '@nestjs/common'
import { PersonProfilesService } from './person-profiles.service'
import { PersonLookupService } from './person-lookup.service'

// The three columns that decide whether a profile page is live. They ride on
// whatever read already fetched the user, so a caller learns "not live" with
// no query of its own.
export interface PublicProfileGate {
  personId: string
  publishedAt: Date | null
  deletedAt: Date | null
}

// Where a candidate's public profile page can be reached today. The gate is
// the one the marketing site renders behind (PublicPersonProfilesController):
// published and not deleted, and no removal on record, which outranks a
// published overlay there too. The address is the one the takedown log shows
// operators (PersonLookupService.resolveIdentities), so a caller hands out
// the page's real URL or nothing. "unknown" is a profile the owner did
// publish but that could not be addressed today: election-api did not
// answer, or holds no slug for the person. It is deliberately not
// "not-live", because telling that owner they never published would be
// false.
export type PublicProfileAddress =
  | { status: 'live'; url: string }
  | { status: 'not-live' }
  | { status: 'removed' }
  | { status: 'unknown' }

@Injectable()
export class PublicProfileAddressService {
  // What election-api said about a person, kept for the local day it was
  // asked on: the canonical URL, or that the person has no slug. Both are
  // stable within a day. An unanswered call is not kept, so the next call
  // asks again.
  private readonly byPerson = new Map<
    string,
    { day: string; value: PublicProfileAddress }
  >()

  constructor(
    private readonly profiles: PersonProfilesService,
    private readonly lookup: PersonLookupService,
  ) {}

  async resolve(
    gate: PublicProfileGate | null,
    day: string,
  ): Promise<PublicProfileAddress> {
    if (!gate || !gate.publishedAt || gate.deletedAt) {
      return { status: 'not-live' }
    }
    if (await this.profiles.isRemoved(gate.personId)) {
      return { status: 'removed' }
    }
    const cached = this.byPerson.get(gate.personId)
    if (cached && cached.day === day) return cached.value
    const identities = await this.lookup.resolveIdentities([gate.personId])
    const identity = identities.get(gate.personId)
    if (!identity) return { status: 'unknown' }
    const value: PublicProfileAddress = identity.profileUrl
      ? { status: 'live', url: identity.profileUrl }
      : { status: 'unknown' }
    this.byPerson.set(gate.personId, { day, value })
    return value
  }
}
