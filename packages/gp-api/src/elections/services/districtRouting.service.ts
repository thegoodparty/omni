import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { District } from '../types/elections.types'
import { US_CONGRESSIONAL_DISTRICT_TYPE } from '../util/proposedDistrictName.util'
import { ElectionsService } from './elections.service'

const SERVE_ORG_SLUG_PREFIX = 'eo-'

@Injectable()
export class DistrictRoutingService {
  constructor(
    private readonly elections: ElectionsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DistrictRoutingService.name)
  }

  async routeWinDistrict(
    orgSlug: string,
    current: District,
  ): Promise<District> {
    if (orgSlug.startsWith(SERVE_ORG_SLUG_PREFIX)) return current
    if (current.L2DistrictType !== US_CONGRESSIONAL_DISTRICT_TYPE) {
      return current
    }

    const districtNumber = Number(current.L2DistrictName)
    if (!Number.isInteger(districtNumber)) return current

    const proposed = await this.elections.findProposedCongressionalDistrict(
      current.state,
      districtNumber,
    )
    if (!proposed) return current

    // The only way to tell in prod which map a campaign's numbers describe.
    this.logger.info(
      {
        orgSlug,
        fromDistrictId: current.id,
        toDistrictId: proposed.id,
        toDistrictName: proposed.L2DistrictName,
      },
      'Routed Win district to the adopted 2026 map',
    )

    return proposed
  }
}
