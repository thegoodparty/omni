import { BadRequestException, Injectable } from '@nestjs/common'
import {
  DoorKnockingDemographicsShape,
  DoorKnockingEvaluateResponse,
  DoorKnockingEvaluateResponseSchema,
  DoorKnockingResidentsResponse,
  DoorKnockingResidentsResponseSchema,
  DoorKnockingResidentTarget,
} from '@goodparty_org/contracts'
import { DatabricksVoterService } from '../databricks/databricksVoter.service'
import { VoterReadLogService } from '../databricks/voterReadLog.service'
import type {
  DbxEvaluateRow,
  DbxResidentRow,
} from '../databricks/databricksVoterSql.util'
import {
  mapAge,
  mapBusinessOwner,
  mapEducation,
  mapHomeowner,
  mapLanguage,
  mapMaritalStatus,
  mapPoliticalParty,
  mapPresenceOfChildren,
  mapVeteranStatus,
  mapVoterStatus,
} from '../utils/transformToPersonOutput.util'
import {
  DoorKnockingEvaluateDTO,
  DoorKnockingResidentsDTO,
} from '../schemas/doorKnocking.schema'

// The eleven attributes the door shows for a target, through the same display
// mappers `/v1/contacts` person detail already uses — the mapping is decided
// there, and a second interpretation of `Home Owner` or `Inferred Married`
// living here is how the door and the CRM start describing one voter two ways.
//
// Every field has a real null case and sparseness is the normal condition of
// this file, not an edge: the caller renders a null identically for all eleven
// rather than letting some vanish and others read "Unknown".
const mapDemographics = (
  row: DbxResidentRow,
): Pick<
  DoorKnockingResidentTarget,
  keyof typeof DoorKnockingDemographicsShape
> => ({
  registeredVoter: row.registered,
  // `Voter_Status` is turnout propensity, not registration activity — see the
  // contract, which renames it on the way out for exactly that reason. The
  // file's `Unknown` sentinel maps to null rather than being carried through.
  turnoutLikelihood: mapVoterStatus(row.Voter_Status),
  maritalStatus: mapMaritalStatus(row.Marital_Status),
  hasChildrenUnder18: mapPresenceOfChildren(row.Presence_Of_Children),
  // Presence-only, both of these: the mappers return 'Yes' or null, because
  // the columns hold a value meaning yes or nothing at all. There is no "No"
  // to emit and the contract's `z.enum(['Yes'])` is what enforces it.
  veteranStatus: mapVeteranStatus(row.Veteran_Status),
  businessOwner: mapBusinessOwner(row.Business_Owner),
  homeowner: mapHomeowner(row.Homeowner_Probability_Model),
  levelOfEducation: mapEducation(row.Education_Of_Person),
  // The raw amount; the door buckets it through INCOME_RANGE_MAPPING at
  // render, so a modelled figure is never printed to the dollar.
  estimatedIncomeAmount: row.Estimated_Income_Amount_Int,
  // No data stays null, exactly as `politicalParty` above does. `mapLanguage`
  // now draws this line itself, so the guard this used to need is gone.
  language: mapLanguage(row.Language_Code),
})

const shapeEvaluate = (
  rows: DbxEvaluateRow[],
  dto: DoorKnockingEvaluateDTO,
): DoorKnockingEvaluateResponse => {
  // maxPeople is a guard, not pagination: over the cap the whole request
  // fails, so an oversized polygon can't silently truncate to a wrong roster
  // or stream a whole voter file. The query LIMITs cap + 1, so the overflow
  // is detected without counting.
  if (rows.length > dto.maxPeople) {
    throw new BadRequestException(
      `Turf evaluation matched more than ${dto.maxPeople} people — ` +
        'shrink the polygon or narrow the filters',
    )
  }

  return DoorKnockingEvaluateResponseSchema.parse({ people: rows })
}

const shapeResidents = (
  rows: DbxResidentRow[],
  dto: DoorKnockingResidentsDTO,
  residentsCap: number,
): DoorKnockingResidentsResponse => {
  // Mirrors evaluate's guard: reject rather than silently truncate — a
  // truncated response would serve wrong rosters. The cap is generous
  // (unit-level addressKeys hold household-sized populations).
  if (rows.length > residentsCap) {
    throw new BadRequestException(
      'Residents lookup exceeded the expected population for this route',
    )
  }

  const targetIds = new Set<string>(dto.targetPersonIds)
  const byAddress = new Map<
    string,
    DoorKnockingResidentsResponse['addresses'][number]
  >()
  for (const row of rows) {
    let address = byAddress.get(row.addressKey)
    if (!address) {
      address = {
        addressKey: row.addressKey,
        targets: [],
        otherResidents: [],
      }
      byAddress.set(row.addressKey, address)
    }
    if (targetIds.has(row.id)) {
      address.targets.push({
        personId: row.id,
        firstName: row.firstName,
        lastName: row.lastName,
        age: mapAge(row),
        // No party data (null/empty) stays null — unlike /v1/people
        // output, which collapses it to 'Other'. A non-empty unrecognized
        // value (Green, Libertarian, …) IS a real registration and maps
        // to 'Other' deliberately; the ?? null only narrows the mapper's
        // optional return type.
        politicalParty: row.Parties_Description
          ? (mapPoliticalParty(row.Parties_Description) ?? null)
          : null,
        // Blank-vs-NULL is not consistent across the voter file, and a blank
        // would render as an empty phone row at the door.
        cellPhone: row.cellPhone?.trim() || null,
        landline: row.landline?.trim() || null,
        ...mapDemographics(row),
      })
    } else {
      address.otherResidents.push({
        personId: row.id,
        firstName: row.firstName,
        lastName: row.lastName,
      })
    }
  }

  // A requested addressKey with no current residents is simply absent — the
  // caller renders that unit from its frozen snapshot.
  return DoorKnockingResidentsResponseSchema.parse({
    addresses: [...byAddress.values()],
  })
}

@Injectable()
export class VoterDoorKnockingService {
  constructor(
    private readonly databricks: DatabricksVoterService,
    private readonly readLog: VoterReadLogService,
  ) {}

  // Both reads get their ROWS from Databricks and shape them here, in the
  // module-level functions above. That placement is deliberate and the one
  // thing to preserve if you touch this: the reject-rather-than-truncate rule
  // is a correctness invariant, not a query implementation detail, and it
  // belongs beside the roster shaping rather than inside the query.
  async evaluate(
    dto: DoorKnockingEvaluateDTO,
    opts?: { requireRooftopAccuracy?: boolean },
  ): Promise<DoorKnockingEvaluateResponse> {
    const rows = await this.readLog.measure({
      op: 'dk-evaluate',
      districtId: dto.districtId,
      read: () => this.databricks.doorKnockingEvaluateRows(dto, opts),
    })
    return shapeEvaluate(rows, dto)
  }

  // The same read, for a map backdrop rather than a route. `evaluate` rejects
  // past its cap because a truncated roster would walk a canvasser down half
  // a street; nobody is routed off this one. Refusing to draw teaches the
  // holder nothing, so an oversized district comes back as its first
  // `maxPeople` dots with `truncated` set, which is what every other map in
  // the CRM already does.
  async evaluatePoints(
    dto: DoorKnockingEvaluateDTO,
    opts?: { requireRooftopAccuracy?: boolean },
  ): Promise<{
    people: DoorKnockingEvaluateResponse['people']
    truncated: boolean
  }> {
    const rows = await this.readLog.measure({
      op: 'dk-evaluate-points',
      districtId: dto.districtId,
      read: () => this.databricks.doorKnockingEvaluateRows(dto, opts),
    })
    // The query LIMITs cap + 1, so overflow is known without counting past it.
    const truncated = rows.length > dto.maxPeople
    const { people } = DoorKnockingEvaluateResponseSchema.parse({
      people: truncated ? rows.slice(0, dto.maxPeople) : rows,
    })
    return { people, truncated }
  }

  async residents(
    dto: DoorKnockingResidentsDTO,
  ): Promise<DoorKnockingResidentsResponse> {
    const residentsCap = dto.targetPersonIds.length * 10
    const rows = await this.readLog.measure({
      op: 'dk-residents',
      districtId: dto.districtId,
      read: () => this.databricks.doorKnockingResidentRows(dto, residentsCap),
    })
    return shapeResidents(rows, dto, residentsCap)
  }
}
