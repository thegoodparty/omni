import { Injectable, NotFoundException } from '@nestjs/common'
import {
  buildColumnSelect,
  createElectionDbBase,
  ELECTION_MODELS,
} from '@/electionDb/electionDbBase.util'
import { DEFAULT_PLACE_PAGE_SIZE, PlaceFilterDto } from './places.schema'
import { Prisma } from '@/generated/election-prisma'
import {
  PlaceCore,
  PlaceWithCategories,
  POSITION_NAMES_COLUMN_NAME,
  SLUG_COLUMN_NAME,
} from './place.types'
import { findMergedRaceHeads } from '@/electionDb/races/races.util'

const COUNTY_MTFCC: Record<string, boolean> = { G4020: true }
const DISTRICT_MTFCC: Record<string, boolean> = {
  G5420: true,
  G5410: true,
  G5400: true,
}

type PlaceTree = PlaceWithCategories & { parent?: PlaceCore | null }

@Injectable()
export class PlacesService extends createElectionDbBase(ELECTION_MODELS.Place) {
  async getPlaces(filterDto: PlaceFilterDto) {
    const {
      page = 1,
      pageSize = DEFAULT_PLACE_PAGE_SIZE,
      includeChildren,
      includeChildRaces,
      includeParent,
      includeRaces,
      categorizeChildren,
      state,
      name,
      slug,
      mtfcc,
      placeColumns,
      raceColumns,
    } = filterDto

    this.logger.debug(`includeChildren: ${includeChildren}`)
    this.logger.debug(`includeParent: ${includeParent}`)

    const baseWhere: Prisma.PlaceWhereInput = {
      ...(state ? { state } : {}),
      ...(name ? { name } : {}),
      ...(mtfcc ? { mtfcc } : {}),
      ...(slug ? { slug } : {}),
    }

    let placeSelectBase: Prisma.PlaceSelect | undefined = placeColumns
      ? (buildColumnSelect(placeColumns) as Prisma.PlaceSelect)
      : undefined
    // Races are attached by place id, so a column selection that leaves `id`
    // out has to load it anyway and drop it again before returning.
    const stripPlaceId = Boolean(
      includeRaces && placeSelectBase && !placeSelectBase.id,
    )
    if (stripPlaceId && placeSelectBase) {
      placeSelectBase = { ...placeSelectBase, id: true }
    }

    const raceInclude = this.buildRaceInclude(raceColumns, includeRaces)
    const childRaceInclude = this.buildRaceInclude(
      raceColumns,
      includeChildRaces,
    )
    // Races under the place, its parent and (when races are merged) its
    // children are not loaded through the nested relation. That would pull
    // every Race row per slug and merge them in JS, which froze the event
    // loop on large counties. They are merged in Postgres and attached below.
    // Children loaded with races but without `includeRaces` never were merged,
    // so they keep the plain nested read.
    const mergeChildRaces = includeChildRaces && includeRaces
    const placeSelection = this.makePlaceSelection(
      false,
      placeSelectBase,
      raceInclude,
    )

    const childrenPlaceSelection = this.makePlaceSelection(
      includeChildRaces && !mergeChildRaces,
      placeSelectBase,
      childRaceInclude,
    )

    const placeQueryObj = {
      ...(placeSelectBase ?? {}),
      ...(includeChildren && { children: childrenPlaceSelection }),
      ...(includeParent && { parent: placeSelection }),
    }

    this.logger.debug(placeQueryObj)
    let places: PlaceTree[] = []

    places = await this.runQuery(
      baseWhere,
      placeSelectBase,
      placeQueryObj,
      page,
      pageSize,
    )

    if (includeRaces) {
      await this.attachMergedRaces(
        places,
        raceInclude,
        includeChildren && mergeChildRaces,
        includeParent,
      )
    }

    if (categorizeChildren) {
      for (const place of places) {
        place.counties = []
        place.districts = []
        place.others = []
        if (!place.children) continue
        for (const child of place.children) {
          if (child.mtfcc && COUNTY_MTFCC[child.mtfcc]) {
            place.counties.push(child)
          } else if (child.mtfcc && DISTRICT_MTFCC[child.mtfcc]) {
            place.districts.push(child)
          } else {
            place.others.push(child)
          }
        }
        delete place.children
      }
    }

    if (!places || places.length === 0) {
      throw new NotFoundException(
        `No places found for query: ${JSON.stringify(baseWhere)}`,
      )
    }
    if (stripPlaceId) this.stripPlaceIds(places)

    return places
  }

  private stripPlaceIds(places: PlaceTree[]) {
    for (const place of places) {
      const related = [
        place.parent,
        ...(place.children ?? []),
        ...(place.counties ?? []),
        ...(place.districts ?? []),
        ...(place.others ?? []),
      ]
      for (const node of related) {
        if (node) delete (node as { id?: string }).id
      }
      delete (place as { id?: string }).id
    }
  }

  async getPlacesWithMostElections(minRaces: number, count: number) {
    const places = await this.client.$queryRaw<
      { slug: string; name: string; race_count: number }[]
    >`
      SELECT   p.slug,
               p.name,
               COUNT(r.id)::int AS race_count
      FROM     "Place" p
      LEFT JOIN "Race" r ON r."place_id" = p.id
      WHERE    p."mtfcc" <> 'G4000'
      GROUP BY p.id
      HAVING   COUNT(r.id) > ${minRaces}
      ORDER BY race_count DESC
      LIMIT    ${count};
    `
    return places
  }

  private buildRaceInclude(
    raceColumns: string | undefined | null,
    includeRaces: boolean | undefined | null,
  ) {
    if (!raceColumns) return true
    if (!includeRaces) return true

    // Force add slug and positionNames so we can dedupe by slug
    const cols = Array.from(
      new Set([
        ...raceColumns.split(','),
        SLUG_COLUMN_NAME,
        POSITION_NAMES_COLUMN_NAME,
      ]),
    ).join(',')

    return {
      select: buildColumnSelect(cols) as Prisma.RaceSelect,
    }
  }

  private makePlaceSelection(
    withRaces: boolean,
    placeSelectBase: Prisma.PlaceSelect | undefined,
    raceInclude:
      | true
      | {
          select: Prisma.RaceSelect
        },
  ) {
    if (!placeSelectBase) {
      if (!withRaces) return true

      return {
        include: {
          Races: raceInclude,
        },
      }
    }
    const sel: Prisma.PlaceSelect = { ...placeSelectBase }
    if (withRaces) sel.Races = raceInclude
    return { select: sel }
  }

  // Loads each place's races merged by slug in Postgres (see
  // findMergedRaceHeads) and sets `Races` on the places, and on their children
  // and parent when asked. Modifies the passed in places for performance.
  private async attachMergedRaces(
    places: PlaceTree[],
    raceInclude: true | { select: Prisma.RaceSelect },
    withChildren: boolean,
    withParent: boolean,
  ) {
    const targets: { id: string; Races?: unknown }[] = [...places]
    for (const place of places) {
      if (withChildren) targets.push(...(place.children ?? []))
      if (withParent && place.parent) targets.push(place.parent)
    }
    const placeIds = [...new Set(targets.map((t) => t.id))]

    const heads = placeIds.length
      ? await findMergedRaceHeads(
          this.client,
          Prisma.sql`place_id = ANY(${placeIds}::uuid[])`,
          true,
        )
      : []
    const headById = new Map(heads.map((h) => [h.id, h]))

    const orderBy: Prisma.RaceOrderByWithRelationInput[] = [
      { slug: 'asc' },
      { id: 'asc' },
    ]
    const headIds = heads.map((h) => h.id)
    const rows =
      raceInclude === true
        ? await this.client.race.findMany({
            where: { id: { in: headIds } },
            omit: { positionNames: true },
            orderBy,
          })
        : await this.client.race.findMany({
            where: { id: { in: headIds } },
            select: { ...raceInclude.select, positionNames: false },
            orderBy,
          })

    const racesByPlace = new Map<string, unknown[]>()
    for (const row of rows) {
      const head = headById.get(row.id)
      if (!head?.placeId) continue
      const race = { ...row, positionNames: head.positionNames }
      const list = racesByPlace.get(head.placeId)
      if (list) list.push(race)
      else racesByPlace.set(head.placeId, [race])
    }

    for (const target of targets) {
      target.Races = [...(racesByPlace.get(target.id) ?? [])]
    }
  }

  private async runQuery<
    T extends Prisma.PlaceSelect | Prisma.PlaceInclude | undefined,
  >(
    where: Prisma.PlaceWhereInput | object,
    placeSelectBase: Prisma.PlaceSelect | undefined,
    placeQueryObj: T,
    page: number,
    pageSize: number,
  ) {
    // `id` because pagination needs a total order on a unique column.
    const paging = {
      orderBy: { id: Prisma.SortOrder.asc },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }

    return placeSelectBase
      ? this.model.findMany({
          where,
          select: placeQueryObj,
          ...paging,
        })
      : this.model.findMany({
          where,
          include: placeQueryObj,
          ...paging,
        })
  }
}
