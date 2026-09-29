import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { DistrictsService } from '@/electionDb/districts/districts.service'

export interface DistrictById {
  id: string
  type: string
  name: string
  state: string
}

// The District table also carries its L2-derived voter aggregates
// (registeredVoters, uniqueCellphones, uniqueLandlines). Only the four
// identity columns are read here, and they are the four this table and
// people-db's District agree on exactly: a checksum over (id, state, type,
// name) across all 131,642 rows matched byte for byte when this was written.
// The parse is what keeps every other column out, now that the read is
// in-process and no HTTP response body narrows the row on the way in.
const districtSchema = z.object({
  id: z.string(),
  state: z.string(),
  L2DistrictType: z.string(),
  L2DistrictName: z.string(),
})

const districtIdSchema = z.guid()

/**
 * Resolves a district for the Databricks voter path from the election data
 * layer rather than from people-db.
 *
 * The election tables own this data; people-db's copy is downstream of it,
 * which is why the ids are required to match. Reading the owner directly is
 * what lets a Databricks-served voter read touch people-db not at all — the
 * district lookup was the last thing keeping that cluster on the path.
 */
@Injectable()
export class ElectionApiDistrictService {
  constructor(
    private readonly districtsService: DistrictsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ElectionApiDistrictService.name)
  }

  async findDistrictById(id: string): Promise<DistrictById> {
    // District.id is @db.Uuid, so a malformed id makes Prisma raise rather
    // than miss. It can never name a row, so it is a miss here.
    if (!districtIdSchema.safeParse(id).success) {
      throw new NotFoundException(`District not found for id=${id}`)
    }

    const district = await this.districtsService.findUnique({ where: { id } })
    if (!district) {
      throw new NotFoundException(`District not found for id=${id}`)
    }

    const parsed = districtSchema.safeParse(district)
    if (!parsed.success) {
      this.logger.error(
        { issues: parsed.error.issues, districtId: id },
        'district row failed schema validation',
      )
      throw new BadGatewayException('Failed to resolve district')
    }

    return {
      id: parsed.data.id,
      type: parsed.data.L2DistrictType,
      name: parsed.data.L2DistrictName,
      state: parsed.data.state,
    }
  }
}
