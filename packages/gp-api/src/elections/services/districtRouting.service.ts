import { Injectable, NotFoundException } from '@nestjs/common'
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
    if (!Number.isInteger(districtNumber) || districtNumber < 1) {
      return current
    }

    let proposed: District | null
    try {
      proposed = await this.elections.findProposedCongressionalDistrict(
        current.state,
        districtNumber,
      )
    } catch (error) {
      // Only a missing map keeps the current district. The lookup already maps
      // that case to null, so reaching here means a collaborator broke that
      // contract — degrade, but say so loudly.
      //
      // A genuine fault is deliberately NOT caught. Swallowing one would let
      // transient election-api flakiness move a campaign between electorates
      // between requests, so a count and the list behind it could be computed
      // against different maps seconds apart. Failing the request is the
      // honest outcome, and the caller was already depending on election-api
      // to have resolved its position at all.
      if (!(error instanceof NotFoundException)) throw error

      this.logger.warn(
        { error, orgSlug, state: current.state, districtNumber },
        'Proposed-district lookup threw not-found; keeping current district',
      )
      return current
    }
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
