import { Injectable } from '@nestjs/common'
import {
  Bbox,
  DoorKnockingEvaluateResponse,
  DoorKnockingPackRequest,
  DoorKnockingResidentsResponse,
  IdOverrides,
} from '@goodparty_org/contracts'
import { FilterObject } from '@/contacts/utils/voterFileFilter.utils'
import { VoterDoorKnockingService } from '@/peopleDb/services/voterDoorKnocking.service'
import { VoterPackService } from '@/peopleDb/services/voterPack.service'
import {
  DoorKnockingEvaluateDTO,
  DoorKnockingResidentsDTO,
} from '@/peopleDb/schemas/doorKnocking.schema'

// Sized from the 150-stop cap times observed voters-per-stop (~4 in dense
// cities) with generous headroom; the query rejects (never truncates) past
// this, so an oversized polygon fails loudly.
const EVALUATE_MAX_PEOPLE = 20_000

// Adapter from the door-knocking module's evaluate/residents/pack calls to
// the in-process people-db query services. Kept as its own seam so the
// callers don't take a direct peopleDb dependency and their call shapes stay
// stable.
@Injectable()
export class DoorKnockingPeopleApiService {
  constructor(
    private readonly voterDoorKnocking: VoterDoorKnockingService,
    private readonly voterPack: VoterPackService,
  ) {}

  evaluate(args: {
    districtId: string
    bbox: Bbox
    filters: FilterObject
    idOverrides?: IdOverrides
    contactsMadeIdOverrides?: IdOverrides
    excludePersonIds?: string[]
  }): Promise<DoorKnockingEvaluateResponse> {
    return this.voterDoorKnocking.evaluate(
      DoorKnockingEvaluateDTO.create({
        districtId: args.districtId,
        bbox: args.bbox,
        filters: args.filters,
        idOverrides: args.idOverrides,
        contactsMadeIdOverrides: args.contactsMadeIdOverrides,
        maxPeople: EVALUATE_MAX_PEOPLE,
        // Omitted rather than sent empty: the schema tolerates [], but keeping
        // the key absent leaves the request byte-identical for an org that has
        // flagged nobody.
        ...(args.excludePersonIds?.length
          ? { excludePersonIds: args.excludePersonIds }
          : {}),
      }),
    )
  }

  residents(args: {
    districtId: string
    addressKeys: string[]
    targetPersonIds: string[]
  }): Promise<DoorKnockingResidentsResponse> {
    return this.voterDoorKnocking.residents(
      DoorKnockingResidentsDTO.create({
        districtId: args.districtId,
        addressKeys: args.addressKeys,
        targetPersonIds: args.targetPersonIds,
      }),
    )
  }

  pack(
    request: DoorKnockingPackRequest,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    return this.voterPack.build(request, signal)
  }
}
