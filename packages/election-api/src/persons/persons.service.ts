import { Injectable, NotFoundException } from '@nestjs/common'
import {
  buildColumnSelect,
  createPrismaBase,
  MODELS,
} from 'src/prisma/util/prisma.util'
import { PersonFilterDto } from './persons.schema'
import { PositionLevel, Prisma } from '../generated/prisma'

// Candidacy carries PII (`email`); never expose it when nesting candidacies
// under a Person on this public endpoint. The Race is pulled with a narrow,
// non-PII select so consumers can both date a candidacy and link it:
// `electionDate` gives "Recent Experience" its year ("Candidate for Mayor ·
// 2024"), while `slug` + `positionLevel` are the pair gp-marketing feeds to
// buildElectionPositionHrefFromRaceSlug for that row's "View Position" link.
// Without them only the one candidacy the profile fetches in full could resolve
// a position page, so every other run rendered unlinked. Mirrors the office
// side, which reaches the same two fields through Position.Races below.
const CANDIDACY_INCLUDE = {
  omit: { email: true },
  include: {
    Race: { select: { electionDate: true, slug: true, positionLevel: true } },
  },
} as const

// Reaches the office's own Race so each term can carry the position slug the
// public profile's breadcrumb is built from (see attachOfficeContext). Narrow
// selects only — a whole Position/Race per term would balloon the payload.
const OFFICE_HOLDER_INCLUDE = {
  include: {
    Position: {
      select: {
        level: true,
        Races: {
          select: { slug: true, positionLevel: true },
          orderBy: { electionDate: 'desc' },
          take: 1,
        },
      },
    },
  },
} as const

type OfficeHolderPositionContext = {
  level: PositionLevel | null
  Races: { slug: string; positionLevel: PositionLevel }[]
} | null

@Injectable()
export class PersonsService extends createPrismaBase(MODELS.Person) {
  async getPersons(filterDto: PersonFilterDto) {
    const {
      slug,
      personId,
      gpApiUserId,
      ids,
      state,
      columns,
      includeOfficeHolders,
      includeCandidacies,
    } = filterDto

    const where: Prisma.PersonWhereInput = {
      ...(slug && { slug }),
      ...(personId && { id: personId }),
      ...(gpApiUserId && { gpApiUserId }),
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

    // Default path returns every scalar, so omit personal PII and the internal
    // gpApiUserId linkage (filter-only, never broadcast) here too.
    return this.model.findMany({
      where,
      omit: { email: true, phone: true, gpApiUserId: true },
      include: relations,
    })
  }

  // Powers the public profile page: the full spine for one person, including
  // every office term and candidacy, with PII omitted.
  async getPersonById(personId: string) {
    const person = await this.model.findUnique({
      where: { id: personId },
      omit: { email: true, phone: true, gpApiUserId: true },
      include: {
        OfficeHolders: OFFICE_HOLDER_INCLUDE,
        Candidacies: CANDIDACY_INCLUDE,
      },
    })
    if (!person) {
      throw new NotFoundException(`Person not found for id=${personId}`)
    }
    return this.attachOfficeContext(person)
  }

  // gp-marketing builds the /people breadcrumb (`Elections > State > County >
  // City > Position > Name`) by splitting a slug shaped
  // `tx/hidalgo/mission/county-sheriff` into its place path and office segment.
  // Candidates get that slug from Candidacy.Race.slug, but a pure officeholder
  // has no candidacy, so their trail collapsed to `Elections > State > Name`.
  //
  // The office's own Race already carries exactly that slug, so surface it
  // verbatim instead of recomposing one. A hand-built slug would drift: the dbt
  // slugify macro strips `-ccd`, and a place that loses a slug collision gets a
  // geoid suffix (`tx/hidalgo/mission-4848072`), so a recomposed slug would
  // silently point at a 404. Position.placeId is not an alternative either — it
  // was dropped in 20260722000000_drop_position_place_id, never having been
  // populated by the position mart.
  //
  // Every hop is optional: OfficeHolder.positionId is a nullable FK that the
  // officeholder mart fills with a lossy left join, and a Position need not have
  // a Race. An unresolvable term degrades to nulls rather than throwing. The
  // nested Position is dropped again here — it was only pulled to reach the
  // race, and the previous shape exposed no Position at all.
  private attachOfficeContext<
    T extends { OfficeHolders: { Position: OfficeHolderPositionContext }[] },
  >(person: T) {
    return {
      ...person,
      OfficeHolders: person.OfficeHolders.map(
        ({ Position, ...officeHolder }) => {
          // Races for one Position share a place and normalized office name, so
          // the most recent election is a stable pick. Race.positionLevel is
          // non-null where Position.level is nullable, and the marketing parser
          // needs the level to route CITY/LOCAL offices, so prefer the race's.
          const race = Position?.Races[0]
          return {
            ...officeHolder,
            positionSlug: race?.slug ?? null,
            positionLevel: race?.positionLevel ?? Position?.level ?? null,
          }
        },
      ),
    }
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

  // Resolves the public /people/<base>-<id8> URL to a person, returning the same
  // full spine shape as getPersonById (PII omitted). <id8> is the first 8 hex
  // chars of the person's UUID `id`; the app appends it so a bare `first-last`
  // (which is NOT unique — ~82 `jane-doe`s) still resolves to exactly one
  // person. We resolve by that id prefix via an indexed range scan on the `id`
  // PK — never a scan of the non-unique `slug` column. 8 hex is 32 bits, so a
  // few dozen ids table-wide share a prefix; the base slug breaks that rare tie.
  async getPersonBySlug(slug: string) {
    const lastDash = slug.lastIndexOf('-')
    const idPrefix = lastDash >= 0 ? slug.slice(lastDash + 1) : ''
    const basePart = lastDash >= 0 ? slug.slice(0, lastDash) : slug

    // Every minted slug ends in an 8-hex id suffix; anything else can't resolve.
    if (!/^[0-9a-f]{8}$/.test(idPrefix)) {
      throw new NotFoundException(`Person not found for slug=${slug}`)
    }

    const candidates = await this.model.findMany({
      where: { id: this.idPrefixRange(idPrefix) },
      omit: { email: true, phone: true, gpApiUserId: true },
      include: {
        OfficeHolders: OFFICE_HOLDER_INCLUDE,
        Candidacies: CANDIDACY_INCLUDE,
      },
    })

    // Almost always 0-1 rows. Only when two ids share the same 8-hex prefix do
    // we fall back to the base slug to pick the intended person.
    const person =
      candidates.length === 1
        ? candidates[0]
        : (candidates.find((p) => p.slug === basePart) ?? null)

    if (!person) {
      throw new NotFoundException(`Person not found for slug=${slug}`)
    }
    return this.attachOfficeContext(person)
  }

  // Half-open UUID range [<prefix>-0…, <next>-0…) covering every id whose text
  // form starts with the 8-hex prefix — an indexed range on the `id` btree. A
  // LIKE/cast on id::text would defeat the index and full-scan the table. The
  // all-Fs prefix has no successor, so it uses an inclusive max-UUID bound.
  private idPrefixRange(prefix8: string): Prisma.StringFilter {
    const gte = `${prefix8}-0000-0000-0000-000000000000`
    if (prefix8 === 'ffffffff') {
      return { gte, lte: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }
    }
    const next = (parseInt(prefix8, 16) + 1).toString(16).padStart(8, '0')
    return { gte, lt: `${next}-0000-0000-0000-000000000000` }
  }
}
