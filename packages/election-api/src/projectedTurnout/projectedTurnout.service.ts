import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { ProjectedTurnoutUniqueDTO } from './projectedTurnout.schema'
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

    return this.model.findFirst({
      where: {
        electionCode:
          rawElectionCode ?? this.determineElectionCode(electionDate),
        electionYear: this.resolveElectionYear(electionDate, electionYear),
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
    return this.model.findFirst({
      where: {
        districtId,
        electionCode:
          rawElectionCode ?? this.determineElectionCode(electionDate),
        electionYear: this.resolveElectionYear(electionDate, electionYear),
      },
    })
  }

  // A district carries one projection per election year, so a lookup that does
  // not pin the year matches every one of them: Prisma drops an `undefined`
  // from the predicate and `findFirst` has no ordering, so it returns an
  // arbitrary vintage. Callers holding a year pass it; the rest get the year of
  // the election they asked about.
  private resolveElectionYear(
    electionDate: string,
    electionYear?: number,
  ): number {
    return electionYear ?? new Date(electionDate).getUTCFullYear()
  }

  private isTuesdayAfterFirstMondayInNov(date: Date): boolean {
    const day = date.getUTCDate()
    return (
      date.getUTCMonth() === 10 && date.getUTCDay() === 2 && day > 1 && day <= 8
    )
  }

  // The model scores three kinds of election day: even-year November generals,
  // state primary days, and everything else as local. Primary days come from
  // the warehouse-derived calendar and arrive on the race row already tagged,
  // so the only classification left here is November-general versus local — and
  // it no longer depends on the state, because the retrained model dropped the
  // consolidated-general category the odd-November states used to read.
  //
  // Dates are read in UTC so the answer does not depend on the server's zone,
  // and the string is parsed as given: appending a zone suffix turned a full ISO
  // timestamp into an invalid date, which classified every November as local.
  determineElectionCode(electionDate: string): ElectionCode {
    const date = new Date(electionDate)

    if (!this.isTuesdayAfterFirstMondayInNov(date)) {
      return ElectionCode.LocalOrMunicipal
    }

    return date.getUTCFullYear() % 2 === 0
      ? ElectionCode.General
      : ElectionCode.LocalOrMunicipal
  }
}
