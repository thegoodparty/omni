import { Injectable } from '@nestjs/common'
import { OfficeHoldersService } from '@/electionDb/officeHolders/officeHolders.service'

export type WinTerm = { termStartDate: Date; termEndDate: Date }

const sameName = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * The term of a seat a candidate just won, when BallotReady already has the
 * winner's own office-holder record for it: the position the campaign ran
 * for, held by a person with the user's first and last name, with full start
 * and end dates that have not passed. Nothing is derived from an election
 * date and a term length; without such a record Serve onboarding asks.
 */
@Injectable()
export class WinTermService {
  constructor(private readonly officeHolders: OfficeHoldersService) {}

  async forWinner(
    positionId: string | null,
    user: { firstName: string | null; lastName: string | null },
    now: Date = new Date(),
  ): Promise<WinTerm | null> {
    if (!positionId || !user.firstName || !user.lastName) return null
    const holders = await this.officeHolders.model.findMany({
      where: { positionId, isVacant: { not: true } },
      include: { Person: true },
    })
    const terms = holders.flatMap((holder): WinTerm[] =>
      sameName(holder.Person.firstName, user.firstName) &&
      sameName(holder.Person.lastName, user.lastName) &&
      holder.startAt &&
      holder.endAt &&
      holder.endAt.getTime() > now.getTime() &&
      // A year-only record would put a made-up day on the term.
      !holder.termDateSpecificity?.toLowerCase().includes('year')
        ? [{ termStartDate: holder.startAt, termEndDate: holder.endAt }]
        : [],
    )
    const [latest] = terms.sort(
      (a, b) => b.termStartDate.getTime() - a.termStartDate.getTime(),
    )
    return latest ?? null
  }
}
