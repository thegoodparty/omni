import { Injectable } from '@nestjs/common'
import {
  buildColumnSelect,
  createElectionDbBase,
  ELECTION_MODELS,
} from '@/electionDb/electionDbBase.util'
import {
  CandidacyFilterDto,
  DEFAULT_CANDIDACY_PAGE_SIZE,
} from './candidacies.schema'
import { Prisma } from '@/generated/election-prisma'

@Injectable()
export class CandidaciesService extends createElectionDbBase(
  ELECTION_MODELS.Candidacy,
) {
  async getCandidacies(filterDto: CandidacyFilterDto) {
    const {
      slug,
      raceSlug,
      positionId,
      state,
      columns,
      includeStances,
      includeRace,
      raceColumns,
      // Defaulted here as well as in the Zod DTO: the bound is a safety
      // property, so a caller that builds the filter by hand must not be able
      // to opt out of it by omitting the fields.
      page = 1,
      pageSize = DEFAULT_CANDIDACY_PAGE_SIZE,
    } = filterDto

    // raceSlug and positionId both constrain the related Race; merge them into a
    // single relation filter so they can be combined.
    const raceWhere: Prisma.RaceWhereInput = {
      ...(raceSlug && { slug: raceSlug }),
      ...(positionId && { positionId }),
    }

    const where: Prisma.CandidacyWhereInput = {
      ...(slug && { slug }),
      ...(state && { state }),
      ...(Object.keys(raceWhere).length > 0 && { Race: raceWhere }),
    }

    const candidacySelectBase = columns
      ? (buildColumnSelect(columns) as Prisma.CandidacySelect)
      : undefined

    const stanceInclude = { include: { Issue: true } } as const
    const raceInclude = this.buildRaceInclude(raceColumns, includeRace)

    const candidacySelection = this.makeCandidacySelection(
      includeStances ?? false,
      includeRace ?? false,
      candidacySelectBase,
      stanceInclude,
      raceInclude,
    )

    // The column allowlist already keeps PII out of the explicit-`select` path.
    // The default/`include` path returns every scalar field, so omit PII there
    // too — otherwise a plain `GET /candidacies` leaks candidate emails.
    // `id` rather than a business key: pagination needs a total order, and it
    // is the only column guaranteed unique, so no page can repeat or skip a row.
    const paging = {
      orderBy: { id: Prisma.SortOrder.asc },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }

    return candidacySelectBase
      ? this.model.findMany({ where, select: candidacySelection, ...paging })
      : this.model.findMany({
          where,
          omit: { email: true },
          include: candidacySelection,
          ...paging,
        })
  }

  private makeCandidacySelection(
    withStances: boolean,
    withRace: boolean,
    candidacySelectBase: Prisma.CandidacySelect | undefined,
    stanceInclude: { include: { Issue: true } },
    raceInclude:
      | true
      | {
          select: Prisma.RaceSelect
        },
  ): Prisma.CandidacySelect | Prisma.CandidacyInclude | undefined {
    if (!candidacySelectBase) {
      if (!withStances && !withRace) return undefined

      return {
        ...(withStances ? { Stances: stanceInclude } : {}),
        ...(withRace ? { Race: raceInclude } : {}),
      }
    }

    const sel: Prisma.CandidacySelect = { ...candidacySelectBase }
    if (withStances) sel.Stances = stanceInclude
    if (withRace) sel.Race = raceInclude
    return sel
  }

  private buildRaceInclude(
    raceColumns: string | undefined | null,
    includeRace: boolean | undefined | null,
  ) {
    if (!raceColumns) return true
    if (!includeRace) return true

    return {
      select: buildColumnSelect(raceColumns) as Prisma.RaceSelect,
    }
  }
}
