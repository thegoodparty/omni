import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { compareDesc, isAfter } from 'date-fns'
import { OfficeHoldersService } from '@/electionDb/officeHolders/officeHolders.service'
import { ElectionsService } from '@/elections/services/elections.service'

export type WinTerm = { termStartDate: Date; termEndDate: Date }

const sameName = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * What is known about the term of a seat a candidate just won.
 *
 * `forWinner` is the term itself, when BallotReady already has the winner's
 * own office-holder record for it: the position the campaign ran for, held by
 * a person with the user's first and last name, with full start and end dates
 * that have not passed.
 *
 * `termYears` is only the seat's term length. Nothing is derived from it and
 * an election date: it turns the first meeting date a winner confirms in
 * Serve onboarding into an end date (PUT /v1/elected-office/:id).
 */
@Injectable()
export class WinTermService {
  constructor(
    private readonly officeHolders: OfficeHoldersService,
    private readonly elections: ElectionsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WinTermService.name)
  }

  // The first gap in the race's election cadence (`Race.frequency`), keyed by
  // the BallotReady race hash a campaign keeps on `details.raceId`. Null when
  // the campaign names no race or the race carries no usable cadence.
  async termYears(raceId: string | null | undefined): Promise<number | null> {
    if (!raceId) return null
    const cadence = await this.elections.getElectionFrequencyByBrHashId(raceId)
    const [years] = cadence?.frequency ?? []
    return years !== undefined && Number.isInteger(years) && years > 0
      ? years
      : null
  }

  async forWinner(
    positionId: string | null,
    user: { firstName: string | null; lastName: string | null },
    now: Date = new Date(),
  ): Promise<WinTerm | null> {
    if (!positionId || !user.firstName || !user.lastName) return null
    // The term is a convenience, so a failed read logs and asks instead of
    // failing the win.
    let holders
    try {
      holders = await this.officeHolders.model.findMany({
        where: { positionId, isVacant: { not: true } },
        include: { Person: true },
      })
    } catch (err) {
      this.logger.error(
        { err, positionId },
        'Win term lookup failed; onboarding will ask for the term',
      )
      return null
    }
    const terms = holders.flatMap((holder): WinTerm[] =>
      sameName(holder.Person.firstName, user.firstName) &&
      sameName(holder.Person.lastName, user.lastName) &&
      holder.startAt &&
      holder.endAt &&
      isAfter(holder.endAt, now) &&
      // A year-only record would put a made-up day on the term.
      !holder.termDateSpecificity?.toLowerCase().includes('year')
        ? [{ termStartDate: holder.startAt, termEndDate: holder.endAt }]
        : [],
    )
    const [latest] = terms.sort((a, b) =>
      compareDesc(a.termStartDate, b.termStartDate),
    )
    return latest ?? null
  }
}
