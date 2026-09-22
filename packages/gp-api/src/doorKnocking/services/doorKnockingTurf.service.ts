import { Injectable, NotFoundException } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import {
  DoorKnockingTurf,
  UpdateDoorKnockingTurf,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  OrganizationRole,
  OutreachStatus,
  Prisma,
} from '../../generated/prisma'
import { assertVolunteerAssignedToOutreach } from '../utils/doorKnockingAccess.util'
import { lockTurf } from '../utils/turfLock.util'
import {
  activeTurfScope,
  campaignEnvelopeScope,
  campaignTurfScope,
  railTurfScope,
} from '../utils/turfScope.util'
import { DoorKnockingStatsService } from './doorKnockingStats.service'
import {
  DoorKnockingTurfCounts,
  DoorKnockingTurfCountsService,
} from './doorKnockingTurfCounts.service'

// `totalSeconds` rides the same row the id comes from, so the rail's duration
// costs nothing beyond the column: it is the route's OWN travel time, already
// frozen when the list was created, and not a second estimate computed here.
//
// The envelope comes along on the same include because it is now where the
// lifecycle lives. It is reached through the route rather than by a column on
// the turf, which is the join that has always been there — the route's
// `doorKnockingTurfId` is `@unique`, so the hop is one step in either
// direction and no column was ever needed for it.
const ROUTE_INCLUDE = {
  route: {
    select: {
      id: true,
      totalSeconds: true,
      outreach: { select: { id: true, status: true, archivedAt: true } },
    },
  },
} as const satisfies Prisma.DoorKnockingTurfInclude

type TurfWithRoute = Prisma.DoorKnockingTurfGetPayload<{
  include: typeof ROUTE_INCLUDE
}>

// Every turf is created with its route and envelope in one transaction, so
// both are present on every row this service can read. Prisma still types them
// as nullable — the FKs point the other way, and it cannot know the two are
// written together — so this narrows once, at the read boundary, rather than
// leaving every caller to re-answer a question the model has already settled.
type RoutedTurf = TurfWithRoute & {
  route: NonNullable<TurfWithRoute['route']> & {
    outreach: NonNullable<NonNullable<TurfWithRoute['route']>['outreach']>
  }
}

// The campaign read, as one value rather than three call sites that happen to
// agree. The two campaign WRITES answer with the array
// `GET campaigns/:anchorId` returns, so the drawer can repaint from the
// mutation instead of refetching, and that only holds while the ordering is
// shared rather than coincidental.
const CAMPAIGN_READ = {
  orderBy: { createdAt: Prisma.SortOrder.asc },
  include: ROUTE_INCLUDE,
} as const satisfies Pick<
  Prisma.DoorKnockingTurfFindManyArgs,
  'orderBy' | 'include'
>

const NO_COUNTS: DoorKnockingTurfCounts = {
  doorCount: 0,
  knockedDoorCount: 0,
  peopleCount: 0,
  loggedCount: 0,
}

const toResponse = (
  turf: RoutedTurf,
  counts: DoorKnockingTurfCounts = NO_COUNTS,
): DoorKnockingTurf => ({
  id: turf.id,
  outreachId: turf.route.outreach.id,
  voterFileFilterId: turf.voterFileFilterId,
  name: turf.name,
  color: turf.color,
  geoPoly: turf.geoPoly,
  doorCount: counts.doorCount,
  knockedDoorCount: counts.knockedDoorCount,
  peopleCount: counts.peopleCount,
  loggedCount: counts.loggedCount,
  routeSeconds: turf.route.totalSeconds,
  completed: turf.route.outreach.status === OutreachStatus.completed,
  archivedAt: turf.route.outreach.archivedAt,
  createdAt: turf.createdAt,
  updatedAt: turf.updatedAt,
})

// A turf whose route or envelope is missing cannot be produced by any code
// path 3.0 has, and the migration removed the rows that predate it. Throwing
// rather than degrading is the point: a silent fallback here would put a list
// on the rail with no doors and no lifecycle, which reads as data loss and
// hides the schema violation that caused it.
const assertRouted = (turf: TurfWithRoute): RoutedTurf => {
  const { route } = turf
  if (!route?.outreach) {
    throw new Error(
      `Door-knocking turf ${turf.id} has no route or no outreach envelope; ` +
        'every turf is created with both in one transaction',
    )
  }
  return { ...turf, route: { ...route, outreach: route.outreach } }
}

@Injectable()
export class DoorKnockingTurfService extends createPrismaBase(
  MODELS.DoorKnockingTurf,
) {
  constructor(
    private readonly counts: DoorKnockingTurfCountsService,
    private readonly stats: DoorKnockingStatsService,
    private readonly moduleRef: ModuleRef,
  ) {
    super()
  }

  // The rail is the first screen a candidate lands on, so the counts ride the
  // list rather than costing a fetch per row: ONE batched aggregate across
  // every turf on the rail, whatever the list count.
  //
  // Scoped by surface as well as by org — see `railTurfScope`. This is the one
  // read that needs it, and 3.0 is the first version that can express it.
  //
  // Archived turfs are returned, carrying `archivedAt`, rather than filtered
  // out here, because `door-knocking/print/walkListData.ts` resolves a turf's
  // NAME by scanning this endpoint — hiding a row would silently degrade its
  // PDF to the "Walk list" fallback while the sheet itself still printed fine.
  // The rail does its own filtering. Soft-deleted turfs are a different case
  // and really are gone.
  async list(
    organizationSlug: string,
    scope: { campaignId: number | null },
  ): Promise<DoorKnockingTurf[]> {
    const rows = await this.model.findMany({
      where: railTurfScope(organizationSlug, scope),
      orderBy: { name: 'asc' },
      include: ROUTE_INCLUDE,
    })
    const turfs = rows.map(assertRouted)
    const counts = await this.counts.forRoutes(
      organizationSlug,
      turfs.map((turf) => turf.route.id),
    )
    return turfs.map((turf) => toResponse(turf, counts.get(turf.route.id)))
  }

  // The dual-pane drawer's sibling list: every turf whose Outreach envelope is
  // the anchor itself or points at it via `campaignOutreachId`. The org scope
  // is expressed through `voterFileFilter` the same way `list` does, so a
  // foreign anchorId cannot pull a turf out of another tenant — it just
  // returns empty. No surface filter here (the by-id routes do not carry one,
  // for the same reason `getTurf` does not): an id the caller already holds
  // cannot be made to cross a surface by asking for it on the wrong one.
  //
  // The `where` is shared with the two campaign writes below, which is what
  // makes the set they touch exactly the set this read counted.
  async listCampaign(
    anchorId: number,
    organizationSlug: string,
  ): Promise<DoorKnockingTurf[]> {
    const rows = await this.model.findMany({
      where: campaignTurfScope(anchorId, organizationSlug),
      ...CAMPAIGN_READ,
    })
    return this.withCountsMany(rows.map(assertRouted), organizationSlug)
  }

  // A soft-deleted turf is indistinguishable from one that never existed, so
  // this 404s it like any other miss — same as a turf that isn't yours.
  async findForOrganization(
    id: number,
    organizationSlug: string,
  ): Promise<RoutedTurf> {
    const turf = await this.model.findFirst({
      where: { id, ...activeTurfScope(organizationSlug) },
      include: ROUTE_INCLUDE,
    })
    if (!turf) {
      throw new NotFoundException('Turf not found')
    }
    return assertRouted(turf)
  }

  // Same aggregate over one route. Every turf has one, so unlike the old
  // version there is no branch here that can answer without counts.
  //
  // A volunteer's read is additionally scoped to their own assignment
  // (ENG-11051) — an unassigned volunteer 404s exactly like a cross-org id.
  async get(
    id: number,
    organizationSlug: string,
    userId: number,
    role: OrganizationRole | undefined,
  ): Promise<DoorKnockingTurf> {
    const turf = await this.findForOrganization(id, organizationSlug)
    await assertVolunteerAssignedToOutreach(
      this.moduleRef,
      role,
      turf.route.outreach.id,
      userId,
      'Turf not found',
    )
    return this.withCounts(turf, organizationSlug)
  }

  // Name and colour only — the contract has no other fields to offer. The
  // polygon is what the frozen route was computed from, so it is not editable
  // at all now that every turf carries one; the old `assertNotLocked` guard
  // that used to reject the whole update is gone with the unlocked state it
  // tested for. Refusing the rename too would mean a typo outlives the walk.
  async update(
    id: number,
    organizationSlug: string,
    input: UpdateDoorKnockingTurf,
  ): Promise<DoorKnockingTurf> {
    const turf = await this.model.update({
      where: { id, voterFileFilter: { organizationSlug }, deletedAt: null },
      data: input,
      include: ROUTE_INCLUDE,
    })
    return this.withCounts(assertRouted(turf), organizationSlug)
  }

  // Always a tombstone. Every turf has a route someone was billed for, frozen
  // addresses, and the name snapshots privacy deletion relies on; hard-deleting
  // one would cascade all of that plus the Outreach envelope, silently removing
  // the walk from outreach history. So the row is left intact underneath and
  // dropped from every read path. The hard-delete branch that used to run for
  // an unbought drawing has nothing left to match — 3.0 has no such turf, and
  // the migration removed the ones that predate it. The knock interactions
  // survive either way: they hang off the organization, not this chain.
  async delete(
    id: number,
    organizationSlug: string,
    actorUserId: number,
  ): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const turf = await this.lockAndFind(tx, id, organizationSlug)
      await tx.doorKnockingTurf.update({
        where: { id: turf.id },
        data: { deletedAt: new Date() },
      })
    })

    // A tombstone moves three of the rollup's totals DOWN — the turf-derived
    // numbers all scope to live lists — and HubSpot SETs each property from
    // the event rather than accumulating, so without this the company would
    // hold the pre-delete values until the org's next create, complete or
    // knock. An org that deletes a list and then stops has no next one.
    void this.stats
      .emitCanvassingTotals(actorUserId, organizationSlug)
      .catch(() => undefined)
  }

  // "End knocking session", written straight onto the envelope, which is the
  // only place the lifecycle lives. There is no second row to mirror it onto
  // and therefore nothing left to drift — the guard ordering, the shared
  // timestamp and the unconditional repair write that used to be here were all
  // consequences of having two.
  //
  // Idempotent by early return rather than by writing `completed` over
  // `completed`, which would look equivalent: the envelope carries an
  // `updatedAt`, and the outreach history sorts and reports off the row, so a
  // stray second tap on a finished list must not touch it at all.
  async complete(
    id: number,
    organizationSlug: string,
    actorUserId: number,
    role: OrganizationRole | undefined,
  ): Promise<DoorKnockingTurf> {
    let completedNow = false
    const turf = await this.client.$transaction(async (tx) => {
      const locked = await this.lockAndFind(tx, id, organizationSlug)
      await assertVolunteerAssignedToOutreach(
        this.moduleRef,
        role,
        locked.route.outreach.id,
        actorUserId,
        'Turf not found',
      )
      if (locked.route.outreach.status === OutreachStatus.completed) {
        return locked
      }

      await tx.outreach.update({
        where: { doorKnockingRouteId: locked.route.id },
        data: { status: OutreachStatus.completed },
      })
      completedNow = true
      return this.restamp(locked, { status: OutreachStatus.completed })
    })

    // Behind the same idempotence guard as the write, so a second tap on a
    // finished list emits nothing — the totals would be identical, and a
    // repeated event teaches HubSpot that a list was completed twice.
    if (completedNow) {
      void this.stats
        .emitCanvassingTotals(actorUserId, organizationSlug)
        .catch(() => undefined)
    }

    return this.withCounts(turf, organizationSlug)
  }

  // Archive is a shelf, not a state machine step: it deliberately does NOT
  // require a completed list. The design only offers it after Done, but a
  // candidate who abandons a half-walked list still needs it off the rail, and
  // refusing that would leave delete as the only way out.
  //
  // Idempotent in the archiving direction because the card renders "archived
  // since" and a retry must not walk that date forward. Un-archiving has
  // nothing to preserve — it writes null either way.
  async setArchived(
    id: number,
    organizationSlug: string,
    archived: boolean,
  ): Promise<DoorKnockingTurf> {
    const turf = await this.client.$transaction(async (tx) => {
      const locked = await this.lockAndFind(tx, id, organizationSlug)
      const current = locked.route.outreach.archivedAt
      const archivedAt = archived ? (current ?? new Date()) : null
      if (archivedAt === current) return locked

      await tx.outreach.update({
        where: { doorKnockingRouteId: locked.route.id },
        data: { archivedAt },
      })
      return this.restamp(locked, { archivedAt })
    })
    return this.withCounts(turf, organizationSlug)
  }

  // "Mark the whole campaign done", and deliberately its own entry point
  // rather than a flag on `complete` above. That route is pressed by the
  // walk's own footer and by the rail's `finishAndArchive`, so widening it
  // would let a canvasser finishing one turf close every other turf in the
  // campaign — and completion has no undo anywhere in this product.
  //
  // Done still does not mean every door was knocked. There is no completeness
  // precondition here for the same reason there is none on a single turf: the
  // product's Done is "stop walking this", not "this list is exhausted". The
  // client confirms when siblings are unfinished; the server does not refuse.
  //
  // ONE statement decides and applies the write set, which is why no advisory
  // lock is taken. The per-turf lock exists to serialize a read-then-write,
  // and this has neither: Postgres re-checks the predicate against any row a
  // concurrent per-turf write took first. That same guard is what makes the
  // press idempotent and what keeps a finished sibling's `updatedAt` still,
  // since the outreach history sorts and reports off that column.
  async completeCampaign(
    anchorId: number,
    organizationSlug: string,
    actorUserId: number,
  ): Promise<DoorKnockingTurf[]> {
    const { turfs, completedNow } = await this.client.$transaction(
      async (tx) => {
        const { count } = await tx.outreach.updateMany({
          where: {
            ...campaignEnvelopeScope(anchorId, organizationSlug),
            status: OutreachStatus.in_progress,
          },
          data: { status: OutreachStatus.completed },
        })

        // Read AFTER the write, unlike the per-turf methods, which fold the
        // write into the row they read under their lock. A re-read is unsafe
        // there because a racing delete would 404 an operation that actually
        // succeeded; a LIST has no such failure, since a sibling tombstoned in
        // the window simply drops out of the array, which is the answer the
        // campaign read would give a moment later anyway.
        const rows = await tx.doorKnockingTurf.findMany({
          where: campaignTurfScope(anchorId, organizationSlug),
          ...CAMPAIGN_READ,
        })
        // Lands after a write that cannot have touched anything: the envelope
        // scope admits only envelopes whose turf is live and in this org, so
        // no rows here means no rows there.
        if (rows.length === 0) {
          throw new NotFoundException('Campaign not found')
        }
        return { turfs: rows.map(assertRouted), completedNow: count > 0 }
      },
    )

    // Once for the campaign rather than once per turf, and behind the same
    // guard as the write. The nine totals are org-wide running numbers, so N
    // events would teach HubSpot that N lists finished N times, and a second
    // press would say a campaign finished twice.
    if (completedNow) {
      void this.stats
        .emitCanvassingTotals(actorUserId, organizationSlug)
        .catch(() => undefined)
    }

    return this.withCountsMany(turfs, organizationSlug)
  }

  // The campaign shelf, with the same posture as `setArchived`: it does NOT
  // require a finished campaign, because a candidate who abandons one still
  // needs it off the rail.
  //
  // ONE timestamp for the whole press, guaranteed by shape rather than by
  // care — a single bound parameter on a single statement cannot vary across
  // siblings. `archivedAt: null` is what stops a repeat press walking
  // "archived since" forward, since a sibling already shelved is not matched
  // and keeps its own date. Restore is the mirror and writes nothing the
  // second time for the same reason.
  //
  // No rollup event, matching `setArchived`: archiving moves none of the nine
  // totals, which count live turfs and completed status.
  async setCampaignArchived(
    anchorId: number,
    organizationSlug: string,
    archived: boolean,
  ): Promise<DoorKnockingTurf[]> {
    const turfs = await this.client.$transaction(async (tx) => {
      await tx.outreach.updateMany({
        where: {
          ...campaignEnvelopeScope(anchorId, organizationSlug),
          archivedAt: archived ? null : { not: null },
        },
        data: { archivedAt: archived ? new Date() : null },
      })

      const rows = await tx.doorKnockingTurf.findMany({
        where: campaignTurfScope(anchorId, organizationSlug),
        ...CAMPAIGN_READ,
      })
      if (rows.length === 0) {
        throw new NotFoundException('Campaign not found')
      }
      return rows.map(assertRouted)
    })
    return this.withCountsMany(turfs, organizationSlug)
  }

  // The advisory lock still serializes the three turf mutations against each
  // other, so archive cannot land between delete's read and its write. What it
  // no longer has to hold off is a knock freezing a route mid-transaction:
  // routes are bought at creation, when nothing else can name the turf yet.
  private async lockAndFind(
    tx: Prisma.TransactionClient,
    id: number,
    organizationSlug: string,
  ): Promise<RoutedTurf> {
    await lockTurf(tx, id)
    const turf = await tx.doorKnockingTurf.findFirst({
      where: { id, ...activeTurfScope(organizationSlug) },
      include: ROUTE_INCLUDE,
    })
    if (!turf) {
      throw new NotFoundException('Turf not found')
    }
    return assertRouted(turf)
  }

  // Folds a lifecycle write back into the row that was read under the lock,
  // rather than re-reading it. A re-read after the transaction would race a
  // concurrent delete — the turf would be tombstoned in the gap and the
  // re-read, which filters `deletedAt: null`, would 404 an operation that
  // actually succeeded. Nothing can change the envelope while the lock is
  // held, so patching the two fields locally says the same thing as a query.
  private restamp(
    locked: RoutedTurf,
    outreach: Partial<RoutedTurf['route']['outreach']>,
  ): RoutedTurf {
    return {
      ...locked,
      route: {
        ...locked.route,
        outreach: { ...locked.route.outreach, ...outreach },
      },
    }
  }

  // Counts are deliberately read OUTSIDE the lifecycle transaction. They come
  // from the route rather than the turf, so a racing delete can't 404 them
  // (a soft delete leaves the route in place), and folding the counts
  // aggregate's six queries into the transaction would hold the turf's
  // advisory lock across all of them — on the rail's hot path.
  private async withCounts(
    turf: RoutedTurf,
    organizationSlug: string,
  ): Promise<DoorKnockingTurf> {
    const counts = await this.counts.forRoutes(organizationSlug, [
      turf.route.id,
    ])
    return toResponse(turf, counts.get(turf.route.id))
  }

  // The same read, batched: ONE aggregate across every sibling, whatever the
  // campaign's size. Shared by the campaign read and the two campaign writes
  // so a mutation's array is indistinguishable from the read's, which is what
  // lets the drawer repaint from the response instead of refetching.
  private async withCountsMany(
    turfs: RoutedTurf[],
    organizationSlug: string,
  ): Promise<DoorKnockingTurf[]> {
    const counts = await this.counts.forRoutes(
      organizationSlug,
      turfs.map((turf) => turf.route.id),
    )
    return turfs.map((turf) => toResponse(turf, counts.get(turf.route.id)))
  }
}
