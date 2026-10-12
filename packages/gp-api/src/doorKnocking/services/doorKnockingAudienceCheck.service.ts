import { Injectable } from '@nestjs/common'
import { DoorKnockingAudienceCheckResponse } from '@goodparty_org/contracts'
import { ContactsService } from '@/contacts/services/contacts.service'
import { Organization } from '../../generated/prisma'
import { DoorKnockingAudienceCheck } from '../schemas/doorKnockingAudienceCheck.schema'

// The who step's "does this list keep anybody?", answered from Postgres.
//
// This is the create's own empty-audience refusal, asked two steps earlier.
// `resolveSavedFilterForQuery` is the same call the create and the address
// preview make, and its `empty` flag is the same flag both of them
// short-circuit on — so a list this endpoint calls empty is exactly a list
// the create would refuse, rather than a second opinion that can disagree
// with it.
//
// Touches no table of its own and holds no Prisma client: every branch of
// the resolution reads through ContactsService, which is where the
// contact_current_status and contact_interaction_* reads live.
@Injectable()
export class DoorKnockingAudienceCheckService {
  constructor(private readonly contacts: ContactsService) {}

  async check(
    organization: Organization,
    input: DoorKnockingAudienceCheck,
  ): Promise<DoorKnockingAudienceCheckResponse> {
    // Deliberately not preceded by `resolveEligibleDistrictId`, which every
    // other read in this feature opens with. That call reaches election-api
    // to find the district the voter data will be scanned from, and nothing
    // here is scanned: the resolution below intersects person-id sets out of
    // our own tables and never asks the people database anything. Paying an
    // election-api round trip — and inheriting its failure modes — to answer
    // a question that does not use its answer would put this endpoint's cost
    // back where ADR 0010 took it out of.
    //
    // The consequence is that an org with no resolvable district still gets a
    // real answer here and meets that problem at the draw step instead, which
    // is where `districtUnavailable` is already surfaced.
    const resolved = await this.contacts.resolveSavedFilterForQuery(
      organization,
      input.filters,
    )

    // Only the flag. `resolved.filters` is a people-api query this endpoint
    // has no intention of running, and handing it to the client would put a
    // ready-made voter-data query on the wire for a gate that needs one bit.
    return { empty: resolved.empty }
  }
}
