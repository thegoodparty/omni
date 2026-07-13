import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import {
  ProjectedTurnoutManyQueryDTO,
  ProjectedTurnoutUniqueDTO,
} from './projectedTurnout.schema'
import { ElectionCode } from '../generated/prisma'

@Injectable()
export class ProjectedTurnoutService extends createPrismaBase(
  MODELS.ProjectedTurnout,
) {
  constructor() {
    super()
  }

  async getProjectedTurnout(dto: ProjectedTurnoutUniqueDTO) {
    const {
      electionYear,
      electionDate,
      districtId,
      state,
      L2DistrictType,
      L2DistrictName,
      electionCode: rawElectionCode,
    } = dto

    if (districtId) {
      return this.getByDistrictId(
        districtId,
        electionDate,
        electionYear,
        rawElectionCode,
      )
    }

    const electionCode =
      rawElectionCode ??
      (await this.determineElectionCode(electionDate, state!))
    return this.model.findFirst({
      where: {
        electionCode,
        electionYear,
        district: {
          L2DistrictType,
          L2DistrictName,
          state,
        },
      },
    })
  }

  private async getByDistrictId(
    districtId: string,
    electionDate: string,
    electionYear?: number,
    rawElectionCode?: ElectionCode,
  ) {
    const district = await this.client.district.findUnique({
      where: { id: districtId },
      select: { state: true },
    })
    if (!district) return null

    const electionCode =
      rawElectionCode ??
      (await this.determineElectionCode(electionDate, district.state))
    return this.model.findFirst({
      where: {
        districtId,
        electionCode,
        electionYear,
      },
    })
  }
  async getManyProjectedTurnouts(dto: ProjectedTurnoutManyQueryDTO) {
    const {
      state,
      L2DistrictType,
      L2DistrictName,
      electionYear,
      electionCode,
      includeDistrict,
    } = dto

    const districtInclude =
      state || L2DistrictType || L2DistrictName ? true : includeDistrict

    return districtInclude
      ? this.model.findMany({
          where: {
            district: {
              state,
              L2DistrictType,
              L2DistrictName,
            },
            electionYear,
            electionCode,
          },
          include: { district: districtInclude },
        })
      : this.model.findMany({
          where: {
            electionYear,
            electionCode,
          },
        })
  }

  /**
   * What type of election `electionDate` is for `state`: a lookup against
   * Election_Calendar (General computed from the fixed November rule /
   * Primary from each state's L2 vote history -- see gp-data-platform
   * DATA-2015, PR #595), not something this service computes itself. No
   * match means LocalOrMunicipal -- any date that isn't a known November
   * general or state primary is a local race.
   *
   * No longer returns ConsolidatedGeneral -- see platform-overview.md for
   * what that code used to cover and why it was removed.
   */
  async determineElectionCode(
    electionDate: string,
    state: string,
  ): Promise<ElectionCode> {
    const date = new Date(`${electionDate}T00:00:00`)
    const match = await this.client.electionCalendar.findUnique({
      where: { state_electionDate: { state, electionDate: date } },
    })
    return match?.electionCode ?? ElectionCode.LocalOrMunicipal
  }
}
