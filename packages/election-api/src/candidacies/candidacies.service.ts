import { Injectable } from '@nestjs/common'
import {
  buildColumnSelect,
  createPrismaBase,
  MODELS,
} from 'src/prisma/util/prisma.util'
import {
  PERSON_SOURCED_CANDIDACY_FIELDS,
  PersonRemovalsService,
} from 'src/personRemovals/personRemovals.service'
import { CandidacyFilterDto } from './candidacies.schema'
import { Prisma } from '../generated/prisma'

@Injectable()
export class CandidaciesService extends createPrismaBase(MODELS.Candidacy) {
  constructor(private readonly personRemovals: PersonRemovalsService) {
    super()
  }

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
    if (!candidacySelectBase) {
      const rows = await this.model.findMany({
        where,
        omit: { email: true },
        include: candidacySelection,
      })
      return this.blankRemovedPersons(rows)
    }

    // Narrowing only: makeCandidacySelection returns a select (never undefined)
    // whenever candidacySelectBase is provided, which it is on this branch.
    const select = candidacySelection as Prisma.CandidacySelect

    // A removal is attributed by personId, so it has to be selected whenever a
    // suppressible field is on the way out. Re-added here rather than in the
    // allowlist, then dropped again below, so asking for `image` cannot smuggle
    // an unrequested column into the response.
    const requestsSuppressible = PERSON_SOURCED_CANDIDACY_FIELDS.some(
      (field) => field in select,
    )
    if (!requestsSuppressible) {
      return this.model.findMany({ where, select })
    }

    const personIdRequested = 'personId' in select
    const rows = await this.model.findMany({
      where,
      select: { ...select, personId: true },
    })
    const suppressed = await this.blankRemovedPersons(rows)
    if (personIdRequested) return suppressed
    return suppressed.map(({ personId: _personId, ...rest }) => rest)
  }

  private blankRemovedPersons<T extends Record<string, unknown>>(rows: T[]) {
    return this.personRemovals.blankRemovedPersonFields(
      rows,
      PERSON_SOURCED_CANDIDACY_FIELDS,
      'personId',
    )
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
