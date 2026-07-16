import { Injectable, NotFoundException } from '@nestjs/common'
import {
  buildColumnSelect,
  createPrismaBase,
  MODELS,
} from 'src/prisma/util/prisma.util'
import { RaceFilterDto } from './races.schema'
import { Prisma } from '../generated/prisma'
import { getDedupedRacesBySlug } from './races.util'
import {
  extractFilingFee,
  FilingFeeResult,
} from 'src/positions/util/filingFee.util'

/**
 * Filing-fee result widened with the structured filing-office contact that
 * gp-api surfaces on the Pro-upgrade filing-instructions screen. The three
 * office fields come straight off the matched `Race` row (sourced from
 * BallotReady); the fee fields come from `extractFilingFee`. All nullable —
 * BallotReady leaves them blank for many races.
 */
export interface FilingDetailsByBrHashResult extends FilingFeeResult {
  filingOfficeAddress: string | null
  filingPhoneNumber: string | null
  paperworkInstructions: string | null
}

@Injectable()
export class RacesService extends createPrismaBase(MODELS.Race) {
  constructor() {
    super()
  }

  async findRaces(filterDto: RaceFilterDto) {
    const {
      includePlace,
      includeCandidacies,
      state,
      placeSlug,
      positionLevel,
      raceSlug,
      electionDateStart,
      electionDateEnd,
      isPrimary,
      isRunoff,
      page,
      pageSize,
      raceColumns,
      placeColumns,
      candidacyColumns,
    } = filterDto

    const where: Prisma.RaceWhereInput = {
      ...(state ? { state } : {}),
      ...(placeSlug ? { Place: { slug: placeSlug } } : {}),
      ...(positionLevel ? { positionLevel } : {}),
      ...(raceSlug ? { slug: raceSlug } : {}),
      ...(isPrimary !== undefined ? { isPrimary } : {}),
      ...(isRunoff !== undefined ? { isRunoff } : {}),
      ...(electionDateStart || electionDateEnd
        ? {
            electionDate: {
              ...(electionDateStart
                ? { gte: new Date(electionDateStart) }
                : {}),
              ...(electionDateEnd ? { lte: new Date(electionDateEnd) } : {}),
            },
          }
        : {}),
    }

    const raceSelectBase: Prisma.RaceSelect | undefined = raceColumns
      ? (buildColumnSelect(raceColumns) as Prisma.RaceSelect)
      : undefined

    const placeInclude = this.buildPlaceInclude(placeColumns, includePlace)
    const candidacyInclude = this.buildCandidacyInclude(
      candidacyColumns,
      includeCandidacies,
    )

    const raceQueryObj = {
      ...(raceSelectBase ?? {}),
      ...(includePlace && { Place: placeInclude }),
      ...(includeCandidacies && { Candidacies: candidacyInclude }),
    }

    // Bound the result set. Pagination is over DISTINCT slugs rather than raw
    // rows: this endpoint collapses same-slug Race rows via
    // getDedupedRacesBySlug (merging positionNames), so a plain row-level
    // skip/take could split a slug group across a page boundary and hand
    // callers the same slug twice with a partial positionNames union. Instead
    // resolve the page's slugs first with a grouped query — GROUP BY slug with
    // LIMIT/OFFSET is pushed down to Postgres and reads only the indexed slug
    // column, so it stays memory-bounded — then fetch every row for exactly
    // those slugs so each returned slug is fully merged.
    const slugGroups = await this.model.groupBy({
      by: ['slug'],
      where,
      orderBy: { slug: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
    const pageSlugs = slugGroups.map((group) => group.slug)

    if (pageSlugs.length === 0) {
      // An empty page past the last result is a normal end-of-data signal for
      // an offset-paginated API, not a missing resource. Preserve the historic
      // 404 only for the first page genuinely matching nothing.
      if (page > 1) {
        return []
      }
      throw new NotFoundException(
        `No races found for query: ${JSON.stringify(where)}`,
      )
    }

    const pagedWhere: Prisma.RaceWhereInput = {
      ...where,
      slug: { in: pageSlugs },
    }
    // `id` is the deterministic tiebreaker; slug order keeps same-slug rows
    // adjacent for the dedupe below.
    const orderBy: Prisma.RaceOrderByWithRelationInput[] = [
      { slug: 'asc' },
      { id: 'asc' },
    ]

    const races = raceSelectBase
      ? await this.model.findMany({
          where: pagedWhere,
          select: raceQueryObj,
          orderBy,
        })
      : await this.model.findMany({
          where: pagedWhere,
          include: raceQueryObj,
          orderBy,
        })

    if (!races[0]?.positionNames || !races[0]?.slug) {
      return races
    }
    return getDedupedRacesBySlug(races)
  }

  /**
   * Resolve a filing fee for a Race by its BallotReady hash (`br_hash_id`).
   * Bypasses the Position-based `lookupFilingFee`, which depends on
   * `Position.placeId` not being populated in our data today.
   *
   * `brHashId` isn't unique in the schema, so order by isPrimary/isRunoff
   * (general → primary → runoff) and take one for a deterministic pick.
   *
   * Returns all-nulls for both "no match" and "matched but BR has no fee" —
   * gp-api treats them identically.
   */
  async findFilingFeeByBrHashId(
    brHashId: string,
  ): Promise<FilingDetailsByBrHashResult> {
    const races = await this.model.findMany({
      where: { brHashId },
      select: {
        filingRequirements: true,
        salary: true,
        filingOfficeAddress: true,
        filingPhoneNumber: true,
        paperworkInstructions: true,
      },
      // Postgres sorts NULLs before `false` in ASC order, so an imported
      // row with isPrimary=NULL would beat a real general (false). Force
      // NULLs last to keep the general → primary → runoff preference
      // robust against missing flags in upstream data.
      orderBy: [
        { isPrimary: { sort: 'asc', nulls: 'last' } },
        { isRunoff: { sort: 'asc', nulls: 'last' } },
      ],
      take: 1,
    })
    const race = races[0]
    if (!race) {
      return {
        filingFee: null,
        filingRequirementsText: null,
        extractionSource: null,
        filingOfficeAddress: null,
        filingPhoneNumber: null,
        paperworkInstructions: null,
      }
    }
    return {
      ...extractFilingFee(race.filingRequirements, race.salary),
      filingOfficeAddress: race.filingOfficeAddress,
      filingPhoneNumber: race.filingPhoneNumber,
      paperworkInstructions: race.paperworkInstructions,
    }
  }

  /**
   * Resolve a position's election cadence (`Race.frequency`, an Int[] of
   * inter-election year gaps) and the matched race's election day, keyed by
   * the BallotReady race hash gp-api persists on `campaign.details.raceId`.
   * Mirrors `findFilingFeeByBrHashId`'s by-hash lookup — `brHashId` isn't
   * unique, so order general → primary → runoff for a deterministic pick.
   *
   * Returns empty frequency + null date for "no match" so the consumer can
   * treat a missing race and a race with no cadence identically.
   */
  async findFrequencyByBrHashId(
    brHashId: string,
  ): Promise<{ frequency: number[]; electionDate: string | null }> {
    const races = await this.model.findMany({
      where: { brHashId },
      select: {
        frequency: true,
        electionDate: true,
      },
      orderBy: [
        { isPrimary: { sort: 'asc', nulls: 'last' } },
        { isRunoff: { sort: 'asc', nulls: 'last' } },
      ],
      take: 1,
    })
    const race = races[0]
    if (!race) {
      return { frequency: [], electionDate: null }
    }
    return {
      frequency: race.frequency,
      electionDate: race.electionDate ? race.electionDate.toISOString() : null,
    }
  }

  private buildPlaceInclude(
    placeColumns: string | undefined | null,
    includePlace: boolean | undefined | null,
  ) {
    if (!placeColumns) return true
    if (!includePlace) return true

    return {
      select: buildColumnSelect(placeColumns) as Prisma.PlaceSelect,
    }
  }

  private buildCandidacyInclude(
    candidacyColumns: string | undefined | null,
    includeCandidacies: boolean | undefined | null,
  ) {
    if (!includeCandidacies) return true

    // No explicit columns: include every candidacy scalar EXCEPT PII. Never
    // return bare `true` here — that expands to all columns and would leak
    // candidate emails through GET /races?includeCandidacies=true (CWE-306),
    // the same hole closed in candidacies.service.ts.
    if (!candidacyColumns) return { omit: { email: true } }

    return {
      select: buildColumnSelect(candidacyColumns) as Prisma.CandidacySelect,
    }
  }
}
