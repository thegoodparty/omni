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

// The pipeline publishes cells at several H3 resolutions; res 8 is the default
// the data-team handoff documents when none is given, and the only one the
// public profile has ever asked for. The route pins it rather than taking a
// query param — an unvalidated resolution would let a caller probe for
// resolutions fine enough to undo the k-anonymity the cells were built with.
const DEFAULT_RESOLUTION = 8

// PII + internal linkage stripped from every person response. Named so the
// three reads that serve the full spine can't drift apart on what they hide.
const PERSON_RESPONSE_OMIT = {
  email: true,
  phone: true,
  gpApiUserId: true,
} as const

// The full civics spine for one person: every office term and candidacy.
const PERSON_SPINE_INCLUDE = {
  OfficeHolders: OFFICE_HOLDER_INCLUDE,
  Candidacies: CANDIDACY_INCLUDE,
} as const

// How far to follow a chain of merges (A retired into B, B later retired into
// C). The ETL contract is that PersonMerge.survivingId is already the TERMINAL
// survivor, so a healthy row resolves in zero hops. This is a bounded defense
// so an uncompressed chain costs an extra query instead of 404-ing, and so a
// cycle — which path compression makes impossible, but which no constraint
// forbids — cannot spin.
const MAX_MERGE_HOPS = 4

/** A single precomputed heat-map cell: an H3 centroid and its voter count. */
export interface VoterDensityCell {
  lat: number
  lng: number
  count: number
}

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
  //
  // Deliberately does NOT follow PersonMerge. An id lookup answers "what is
  // this id", and silently returning a different person would be a surprising
  // contract for gp-api, which keys its own rows on the id it asked about.
  // Merge following is confined to by-slug, where resolving a URL to whoever
  // owns it now is the whole job. Callers holding a possibly-retired id ask
  // GET /v1/person-merges/:retiredId and decide for themselves.
  async getPersonById(personId: string) {
    const person = await this.model.findUnique({
      where: { id: personId },
      omit: PERSON_RESPONSE_OMIT,
      include: PERSON_SPINE_INCLUDE,
    })
    if (!person) {
      throw new NotFoundException(`Person not found for id=${personId}`)
    }
    return this.attachOfficeContext(person)
  }

  // The person's contact email, and nothing else. The ONLY read on this service
  // that serves a PERSON_PII_COLUMNS field.
  //
  // Every other person read omits `email` because its response is proxied
  // onward to a public page — gp-marketing renders /people/* straight from
  // getPersonById — so an address riding inside that shape reaches the browser
  // the first time anyone spreads it. Here the address IS the response, so
  // there is no wider payload for it to travel in unnoticed, and a caller has
  // to ask for it by name.
  //
  // The caller is gp-api resolving the subject's HubSpot contact when a visitor
  // asks that person to complete their profile: HubSpot keys contacts on email,
  // and gp_person_id is not a unique property over there. Like every route on
  // this service it is M2M-only (default-deny guard in AuthenticationModule).
  //
  // Null email is ordinary, not an error — the person feed only carries an
  // address for people a source had one for.
  async getContactEmail(
    personId: string,
  ): Promise<{ personId: string; email: string | null }> {
    const person = await this.model.findUnique({
      where: { id: personId },
      select: { email: true },
    })
    if (!person) {
      throw new NotFoundException(`Person not found for id=${personId}`)
    }
    return { personId, email: person.email ?? null }
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

  // The person's heat map in one call: the district resolution above, then the
  // precomputed cells for it. This exists because the cells used to live in
  // people-db, so gp-api had to resolve the district here and then read the
  // cells from a second database; now that both sit in election-db, the caller
  // makes one request and there is no way for the two halves to disagree.
  //
  // There is NO H3 math here. The pipeline already binned voters to H3 cells,
  // k-anonymized them, and stored each cell's centroid, so this is a plain
  // indexed read on (districtId, resolution) plus the matching coverage row.
  //
  // Degradation matches getVoterDistrict, because the page's contract is the
  // same: an unknown person 404s, while a person who resolves to no district —
  // or to a district the pipeline has not published cells for — returns empty
  // cells and null coverage, which the page renders as no map rather than as an
  // error. Coverage is also null when no meta row exists; the page treats
  // null/low coverage as "do not render", so a sparsely covered district shows
  // no map rather than a misleading one.
  async getVoterDensity(
    personId: string,
    resolution: number = DEFAULT_RESOLUTION,
  ): Promise<{
    personId: string
    districtId: string | null
    coverage: number | null
    cells: VoterDensityCell[]
  }> {
    const { districtId } = await this.getVoterDistrict(personId)
    if (!districtId) {
      return { personId, districtId: null, coverage: null, cells: [] }
    }

    // The cells and their coverage meta are independent reads on the same key;
    // fetch them together.
    const [rows, meta] = await Promise.all([
      this.client.districtVoterDensity.findMany({
        where: { districtId, resolution },
        select: { lat: true, lng: true, voterCount: true },
        // Deterministic order keeps responses stable across identical requests.
        orderBy: [{ lat: Prisma.SortOrder.asc }, { lng: Prisma.SortOrder.asc }],
      }),
      this.client.districtVoterDensityMeta.findUnique({
        where: { districtId_resolution: { districtId, resolution } },
        select: { coverage: true },
      }),
    ])

    return {
      personId,
      districtId,
      coverage: meta?.coverage ?? null,
      cells: rows.map((r) => ({ lat: r.lat, lng: r.lng, count: r.voterCount })),
    }
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

  // Resolves the public /people/<slug> URL to a person, returning the same full
  // spine shape as getPersonById (PII omitted). The person mart mints `slug`
  // with a trailing <id8> — the first 8 hex of the person's UUID `id` — which is
  // what makes the whole slug unique, since the `first-last` name part on its
  // own is not (~82 `jane-doe`s).
  //
  // We resolve on that id prefix rather than on `slug` itself, even though slug
  // is unique and indexed, because it lets a stale slug still resolve: people
  // get renamed, the old URL stays linked, and marketing 301s it to the current
  // one. Matching the whole slug would 404 those instead. The range scan is on
  // the `id` PK. 8 hex is 32 bits, so a few dozen ids table-wide share a prefix;
  // the whole slug breaks that rare tie. The name part is optional: a name that
  // slugifies to nothing (non-Latin scripts strip to empty) leaves the id suffix
  // as the entire slug.
  //
  // A URL can also name a person the data team has since PURGED as a duplicate.
  // Because the id8 that makes the slug unique is the deleted row's primary
  // key, there is nothing left in Person to match — so the miss path consults
  // PersonMerge, which holds the purged id's forwarding address, and returns
  // the survivor. gp-marketing then sees a person whose canonical slug differs
  // from the requested one and 308s to it, using the redirect it already runs
  // for renames. See PERSON_ID_RETIREMENT_HANDOFF.md.
  //
  // Precedence, most specific first, so that neither a rename nor a purge can
  // make one person's URL serve a different person:
  //   1. live person, exact slug match      — unambiguous
  //   2. retired id, exact slug match       — unambiguous; redirect
  //   3. retired id, slug reconstructed from its survivor — same claim, for
  //      rows that published no retiredSlug
  //   4. exactly one live person on the prefix    — the rename case
  //   5. exactly one retired id on the prefix     — rename + purge
  //   6. otherwise 404 — an ambiguous prefix is never guessed at
  // The merge rungs cost one extra indexed query, and only when rung 1 misses.
  async getPersonBySlug(slug: string) {
    const idPrefix = /^(?:.*-)?([0-9a-f]{8})$/.exec(slug)?.[1]

    // Every minted slug ends in an 8-hex id suffix; anything else can't resolve.
    if (!idPrefix) {
      throw new NotFoundException(`Person not found for slug=${slug}`)
    }

    const candidates = await this.model.findMany({
      where: { id: this.idPrefixRange(idPrefix) },
      omit: PERSON_RESPONSE_OMIT,
      include: PERSON_SPINE_INCLUDE,
    })

    // (1) The stored slug carries the id suffix, so it is compared whole.
    const exactLive = candidates.find((p) => p.slug === slug)
    if (exactLive) return this.attachOfficeContext(exactLive)

    // Almost always empty. Fetched once and used for every merge rung.
    const merges = await this.client.personMerge.findMany({
      where: { retiredId: this.idPrefixRange(idPrefix) },
      select: { retiredId: true, survivingId: true, retiredSlug: true },
    })

    // (2) An exact retired-slug match outranks an inexact live one: this URL
    // demonstrably belonged to the purged person, and resolving it to a
    // different real person who merely shares the 8-hex prefix would conflate
    // the two — in the index as much as on the page.
    const exactMerge = merges.find((m) => m.retiredSlug === slug)
    if (exactMerge) {
      const survivor = await this.loadMergeSurvivor(exactMerge.survivingId)
      if (survivor) return this.attachOfficeContext(survivor)
      // The match was definitive: this URL is that purged person's, and their
      // forwarding address is broken. Falling through to the prefix rungs would
      // hand their URL to whichever live person happens to share the 8 hex —
      // the exact conflation this rung exists to prevent. The URL is
      // unresolvable, not ambiguous, so stop here.
      throw new NotFoundException(`Person not found for slug=${slug}`)
    }

    // (3) The same claim as rung 2, reconstructed rather than published. A
    // purged duplicate and its survivor are the same human, so the survivor's
    // slug base is what the duplicate's own slug was minted from — recovering
    // it costs a lookup we already know how to do and costs the data team
    // nothing to maintain. Only same-name duplicates match, which is the common
    // shape; a duplicate carrying a name variant falls through to the guard.
    //
    // This cannot take a live person's URL by mistake: rung 1 already claimed
    // every request matching a live slug exactly, so reaching a match here
    // implies the live person on this prefix is published under a different
    // name than the survivor.
    //
    // Resolved once here because the lone-retired rung below needs the same
    // lookup, and on the ordinary purge path — a retired id with no live
    // neighbour — it would otherwise run twice for every request. A prefix
    // virtually never carries more than one retired id.
    const forwards = await Promise.all(
      merges.map(async (merge) => ({
        merge,
        survivor: await this.loadMergeSurvivor(merge.survivingId),
      })),
    )

    for (const { merge, survivor } of forwards) {
      // A published slug is authoritative, and rung 2 already compared it. That
      // it did not match is a real answer, not a gap to reconstruct around.
      if (merge.retiredSlug !== null || !survivor) continue
      if (this.mintedSlugFor(survivor.slug, merge.retiredId) !== slug) continue

      return this.attachOfficeContext(survivor)
    }

    // A purged id that published no slug and did not reconstruct cannot be
    // ruled out by name: reconstruction only ever proves a match, never a
    // non-match, because a duplicate may carry a name variant its survivor does
    // not. While one of those shares the prefix, we cannot tell whose URL this
    // is.
    //
    // Deliberately keyed on the row, not on whether its survivor loaded. A row
    // whose forwarding address is broken can serve nobody, but it is still
    // evidence that a purged person held this prefix, so it still makes the URL
    // ambiguous. If the URL was in fact that person's, 404 is the right answer
    // anyway — the same conclusion rung 2 reaches for a broken forward it
    // matched exactly. Reading the survivor here would instead hand their URL
    // to a live neighbour, which is the one outcome worth avoiding.
    const unresolvedRetired = merges.some((m) => m.retiredSlug === null)

    // (4) One live person owns the prefix and the URL carries a stale name.
    // Withheld while a purged id on the prefix is still unresolved: serving the
    // live person would hand a purged person's URL to an unrelated human, and
    // gp-marketing now answers that with a 308, which tells search engines the
    // two are one page. A dead link is recoverable; a permanent redirect onto
    // the wrong candidate is not.
    if (candidates.length === 1 && !unresolvedRetired) {
      return this.attachOfficeContext(candidates[0]!)
    }

    // (5) Same, for a purged person: one retired id owns the prefix and no live
    // person contests it.
    //
    // Deliberately admits rows whose published retiredSlug did NOT match at
    // rung 2, for the same reason rung 4 admits any stale name: a person
    // renamed before being purged has older URLs that cannot match the single
    // final slug the row carries, and those are exactly the links most in need
    // of forwarding. A non-match is not proof the URL was never theirs — only
    // an exact match ever proves whose a URL is. With no live candidate on the
    // prefix there is nobody to conflate them with, so the permissiveness is
    // free here in a way it is not at rung 4.
    if (forwards.length === 1 && candidates.length === 0) {
      const { survivor } = forwards[0]!
      if (survivor) return this.attachOfficeContext(survivor)
    }

    // (6) Zero or ambiguous.
    throw new NotFoundException(`Person not found for slug=${slug}`)
  }

  // Loads the person a purged duplicate forwards to, following any residual
  // chain to its end. Returns null when the survivor is itself missing — a
  // broken forwarding address is a 404, not an error: the caller's URL is
  // still unresolvable and there is nothing truthful to serve.
  private async loadMergeSurvivor(survivingId: string) {
    const terminalId = await this.resolveTerminalSurvivor(survivingId)
    return this.model.findUnique({
      where: { id: terminalId },
      omit: PERSON_RESPONSE_OMIT,
      include: PERSON_SPINE_INCLUDE,
    })
  }

  // Walks PersonMerge until an id is not itself retired. Normally exits on the
  // first probe, because the ETL publishes terminal survivors; the loop and the
  // `seen` set bound the damage if it ever publishes a chain or a cycle.
  private async resolveTerminalSurvivor(survivingId: string): Promise<string> {
    let current = survivingId
    const seen = new Set([current])

    for (let hop = 0; hop < MAX_MERGE_HOPS; hop++) {
      const next = await this.client.personMerge.findUnique({
        where: { retiredId: current },
        select: { survivingId: true },
      })
      if (!next || seen.has(next.survivingId)) return current
      seen.add(next.survivingId)
      current = next.survivingId
    }
    return current
  }

  // The slug a purged row would carry if it were published under its survivor's
  // name: the survivor's slug base, with the purged id's own 8-hex suffix. The
  // name part is optional on both sides — a name that slugifies to nothing
  // leaves the suffix as the entire slug — so an empty base yields a bare
  // suffix, exactly as the minting side produces it.
  private mintedSlugFor(survivorSlug: string, retiredId: string): string {
    const base = /^(.*)-[0-9a-f]{8}$/.exec(survivorSlug)?.[1] ?? ''
    const suffix = retiredId.slice(0, 8)
    return base ? `${base}-${suffix}` : suffix
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
