import { Injectable, NotFoundException } from '@nestjs/common'
import {
  buildColumnSelect,
  createPrismaBase,
  MODELS,
} from 'src/prisma/util/prisma.util'
import { PersonFilterDto } from './persons.schema'
import { Prisma } from '../generated/prisma'

// Candidacy carries PII (`email`); never expose it when nesting candidacies
// under a Person on this public endpoint. The Race's `electionDate` is pulled
// (narrow select, no PII) so consumers can date a candidacy — e.g. the public
// profile's "Recent Experience" ("Candidate for Mayor · 2024").
const CANDIDACY_INCLUDE = {
  omit: { email: true },
  include: { Race: { select: { electionDate: true } } },
} as const

@Injectable()
export class PersonsService extends createPrismaBase(MODELS.Person) {
  async getPersons(filterDto: PersonFilterDto) {
    const {
      slug,
      personId,
      ids,
      state,
      columns,
      includeOfficeHolders,
      includeCandidacies,
    } = filterDto

    const where: Prisma.PersonWhereInput = {
      ...(slug && { slug }),
      ...(personId && { id: personId }),
      ...(ids && ids.length > 0 && { id: { in: ids } }),
      ...(state && { state }),
    }

    const relations = {
      ...(includeOfficeHolders ? { OfficeHolders: true } : {}),
      ...(includeCandidacies ? { Candidacies: CANDIDACY_INCLUDE } : {}),
    }

    // Column allowlist already excludes PII; append relation selects to it.
    if (columns) {
      const select = {
        ...(buildColumnSelect(columns) as Prisma.PersonSelect),
        ...relations,
      }
      return this.model.findMany({ where, select })
    }

    // Default path returns every scalar, so omit personal PII here too.
    return this.model.findMany({
      where,
      omit: { email: true, phone: true },
      include: relations,
    })
  }

  // Powers the public profile page: the full spine for one person, including
  // every office term and candidacy, with PII omitted.
  async getPersonById(personId: string) {
    const person = await this.model.findUnique({
      where: { id: personId },
      omit: { email: true, phone: true },
      include: {
        OfficeHolders: true,
        Candidacies: CANDIDACY_INCLUDE,
      },
    })
    if (!person) {
      throw new NotFoundException(`Person not found for id=${personId}`)
    }
    return person
  }

  // Resolves the L2 voter-join district for a person, for the voter-density
  // heat map. The voter join key is `Position.districtId` (== the shared
  // District.id) — NOT `OfficeHolder.geoId` (a Census Place code that does not
  // join to voters). Two chains reach it:
  //   Officeholder: Person -> OfficeHolder.positionId -> Position.districtId
  //   Candidate:    Person -> Candidacy.raceId -> Race.positionId -> Position.districtId
  // A sitting office wins over a candidacy; within office holders the current
  // term wins, then the most recently started; candidacies fall back to the
  // most recent election. Returns { districtId: null } when the person exists
  // but no office/candidacy resolves to a district (the app then renders no
  // map), and 404 only when the person itself is unknown.
  async getVoterDistrict(personId: string): Promise<{
    personId: string
    districtId: string | null
    state: string | null
  }> {
    const person = await this.model.findUnique({
      where: { id: personId },
      select: {
        state: true,
        OfficeHolders: {
          select: {
            isCurrent: true,
            startAt: true,
            Position: { select: { districtId: true } },
          },
        },
        Candidacies: {
          select: {
            Race: {
              select: {
                electionDate: true,
                Position: { select: { districtId: true } },
              },
            },
          },
        },
      },
    })

    if (!person) {
      throw new NotFoundException(`Person not found for id=${personId}`)
    }

    const officeDistrict = this.pickOfficeHolderDistrict(person.OfficeHolders)
    const districtId =
      officeDistrict ?? this.pickCandidacyDistrict(person.Candidacies)

    return { personId, districtId, state: person.state ?? null }
  }

  private pickOfficeHolderDistrict(
    officeHolders: {
      isCurrent: boolean | null
      startAt: Date | null
      Position: { districtId: string | null } | null
    }[],
  ): string | null {
    const withDistrict = officeHolders.filter(
      (oh) => oh.Position?.districtId != null,
    )
    if (withDistrict.length === 0) return null

    const ranked = [...withDistrict].sort((a, b) => {
      // Current term first.
      if (!!a.isCurrent !== !!b.isCurrent) return a.isCurrent ? -1 : 1
      // Then most recently started.
      return (b.startAt?.getTime() ?? 0) - (a.startAt?.getTime() ?? 0)
    })
    return ranked[0]?.Position?.districtId ?? null
  }

  private pickCandidacyDistrict(
    candidacies: {
      Race: {
        electionDate: Date | null
        Position: { districtId: string | null } | null
      } | null
    }[],
  ): string | null {
    const withDistrict = candidacies.filter(
      (c) => c.Race?.Position?.districtId != null,
    )
    if (withDistrict.length === 0) return null

    const ranked = [...withDistrict].sort(
      (a, b) =>
        (b.Race?.electionDate?.getTime() ?? 0) -
        (a.Race?.electionDate?.getTime() ?? 0),
    )
    return ranked[0]?.Race?.Position?.districtId ?? null
  }

  // Resolves the canonical /people/<slug> URL to a person. `slug` is unique, so
  // this returns the same full spine shape as getPersonById (PII omitted).
  async getPersonBySlug(slug: string) {
    const person = await this.model.findUnique({
      where: { slug },
      omit: { email: true, phone: true },
      include: {
        OfficeHolders: true,
        Candidacies: CANDIDACY_INCLUDE,
      },
    })
    if (!person) {
      throw new NotFoundException(`Person not found for slug=${slug}`)
    }
    return person
  }
}
