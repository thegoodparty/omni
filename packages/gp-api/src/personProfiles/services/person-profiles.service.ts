import { BadRequestException, Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { Prisma } from '../../generated/prisma'
import {
  ProfileIssueInput,
  UpsertPersonProfileInput,
} from '../schemas/personProfile.schema'
import { CreateProfileClaimRequestInput } from '../schemas/public/ProfileClaimRequest.schema'

const withIssues = {
  issues: {
    orderBy: { sortOrder: 'asc' },
    // The published issue's title/description come from the Serve Priority the
    // owner chose to surface; the public endpoint flattens these out.
    include: { priority: { select: { title: true, description: true } } },
  },
} satisfies Prisma.PersonProfileInclude

const UNLISTED_PERSON_CAP = 50_000

// The admin takedown log is a screen an operator reads, not a feed a machine
// consumes, so it is capped orders of magnitude below the sitemap ceiling. A
// privacy takedown is a hand-filed request; a log long enough to hit this is a
// signal to build paging, not to raise the number.
const REMOVAL_LIST_CAP = 2_000

@Injectable()
export class PersonProfilesService extends createPrismaBase(
  MODELS.PersonProfile,
) {
  findByPersonId(personId: string) {
    return this.model.findUnique({
      where: { personId },
      include: withIssues,
    })
  }

  // Powers the /people sitemap: only live (published, not deleted) profiles.
  // Hard-capped at the 50k sitemap-URL ceiling so this unauthenticated,
  // unpaginated endpoint can never serialize an unbounded full table into the
  // heap as the /people directory grows. Beyond 50k the sitemap must shard
  // anyway, so the cap costs nothing today.
  listPublished() {
    return this.model.findMany({
      where: { publishedAt: { not: null }, deletedAt: null },
      select: { personId: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 50_000,
    })
  }

  // The /people sitemap emits a URL per person page rather than one per
  // published overlay, so it needs every personId whose page does not render,
  // from either direction: a removal on record (the noindex K/L states) or an
  // owner-deleted overlay (410 Gone, which the marketing loader turns into a
  // 404). Both used to fall out for free when the sitemap listed published
  // profiles only.
  //
  // Capped like listPublished for the same unbounded-heap reason, but the
  // ceiling sits far above any realistic count because truncation is the
  // dangerous direction here: a dropped entry is a URL we advertise and then
  // fail to render.
  async listUnlisted() {
    const [removals, deleted] = await Promise.all([
      this.client.personProfileRemoval.findMany({
        // Only ACTIVE takedowns. A reverted one stays on the table as history,
        // and matching on row existence would keep that person out of the
        // sitemap permanently even though their page renders again.
        where: { clearedAt: null },
        select: { personId: true },
        take: UNLISTED_PERSON_CAP,
      }),
      this.model.findMany({
        where: { deletedAt: { not: null } },
        select: { personId: true },
        take: UNLISTED_PERSON_CAP,
      }),
    ])

    // A person can be both removed and deleted. The consumer builds a Set
    // either way, but duplicates would spend the cap twice on one URL.
    const personIds = new Set([
      ...removals.map(({ personId }) => personId),
      ...deleted.map(({ personId }) => personId),
    ])

    return [...personIds]
      .slice(0, UNLISTED_PERSON_CAP)
      .map((personId) => ({ personId }))
  }

  findByUserId(userId: number) {
    return this.model.findUnique({
      where: { userId },
      include: withIssues,
    })
  }

  createForUser(
    userId: number,
    personId: string,
    data: UpsertPersonProfileInput,
  ) {
    const { accomplishments, recentExperience, ...rest } = data
    return this.model.create({
      data: {
        userId,
        personId,
        ...rest,
        // A fresh profile with no list simply leaves the JSON column null.
        ...(accomplishments != null ? { accomplishments } : {}),
        ...(recentExperience != null ? { recentExperience } : {}),
      },
      include: withIssues,
    })
  }

  updateForUser(userId: number, data: UpsertPersonProfileInput) {
    const { accomplishments, recentExperience, ...rest } = data
    return this.model.update({
      where: { userId },
      data: {
        ...rest,
        // Explicit null clears the JSON column; undefined leaves it untouched.
        ...(accomplishments !== undefined
          ? { accomplishments: accomplishments ?? Prisma.DbNull }
          : {}),
        ...(recentExperience !== undefined
          ? { recentExperience: recentExperience ?? Prisma.DbNull }
          : {}),
      },
      include: withIssues,
    })
  }

  setPublished(userId: number, publishedAt: Date | null) {
    return this.model.update({
      where: { userId },
      data: { publishedAt },
      include: withIssues,
    })
  }

  softDelete(userId: number) {
    return this.model.update({
      where: { userId },
      data: { deletedAt: new Date() },
      include: withIssues,
    })
  }

  // Replaces the owner's per-issue publication settings atomically.
  async replaceIssues(
    personProfileId: string,
    issues: ProfileIssueInput[],
    ownerUserId: number,
  ) {
    // Ownership guard (IDOR): a Priority is owned through its
    // ElectedOffice.userId, and PersonProfileIssue only FKs Priority.id with no
    // user-scoping constraint. Without this check a caller could publish an
    // arbitrary issueId — `withIssues` would then surface another user's
    // Priority title/description on this profile. Only accept issueIds whose
    // Priority belongs to one of the caller's own elected offices. (An empty
    // list is always allowed: it just clears the caller's publications.)
    if (issues.length > 0) {
      const offices = await this.client.electedOffice.findMany({
        where: { userId: ownerUserId },
        select: { id: true },
      })
      const officeIds = offices.map((o) => o.id)
      const owned = officeIds.length
        ? await this.client.priority.findMany({
            where: {
              id: { in: issues.map((i) => i.issueId) },
              electedOfficeId: { in: officeIds },
            },
            select: { id: true },
          })
        : []
      const ownedIds = new Set(owned.map((p) => p.id))
      const bad = issues.find((issue) => !ownedIds.has(issue.issueId))
      if (bad) {
        throw new BadRequestException(
          `issueId ${bad.issueId} does not belong to your elected office`,
        )
      }
    }
    await this.client.$transaction([
      this.client.personProfileIssue.deleteMany({
        where: { personProfileId },
      }),
      this.client.personProfileIssue.createMany({
        data: issues.map((issue) => ({
          personProfileId,
          issueId: issue.issueId,
          visible: issue.visible ?? true,
          status: issue.status ?? null,
          transparency: issue.transparency ?? null,
          sortOrder: issue.sortOrder ?? null,
        })),
      }),
    ])
    return this.model.findUnique({
      where: { id: personProfileId },
      include: withIssues,
    })
  }

  // --- Privacy removal flag (personId-keyed, not on the overlay) ------------
  // Unclaimed persons have no PersonProfile row, so the removal flag lives in
  // its own table keyed by the civics personId. A takedown is ACTIVE only while
  // clearedAt is null; a reverted one stays on the table as history, so every
  // read below has to filter on it rather than on row existence.

  async isRemoved(personId: string): Promise<boolean> {
    const removal = await this.client.personProfileRemoval.findFirst({
      where: { personId, clearedAt: null },
      select: { personId: true },
    })
    return Boolean(removal)
  }

  // Idempotent set (upsert) — flagging an already-removed person refreshes the
  // note/actor/timestamp. Re-flagging a *cleared* person reopens that same row
  // (personId is unique, so there is only ever one), which is why the update
  // resets the revert fields: leaving a stale clearedAt would upsert a takedown
  // that reads as already reverted.
  setRemoval(personId: string, appliedBy: string, note?: string | null) {
    return this.client.personProfileRemoval.upsert({
      where: { personId },
      create: { personId, appliedBy, note: note ?? null },
      update: {
        appliedBy,
        note: note ?? null,
        requestedAt: new Date(),
        clearedAt: null,
        clearedBy: null,
      },
    })
  }

  // updateMany, not update: clearing a person who was never removed (or was
  // already cleared) is a no-op rather than a 500, which keeps the endpoint
  // idempotent for a double-clicked Undo.
  async clearRemoval(personId: string, clearedBy: string): Promise<void> {
    await this.client.personProfileRemoval.updateMany({
      where: { personId, clearedAt: null },
      data: { clearedAt: new Date(), clearedBy },
    })
  }

  // Admin/ops view of the takedown log. Unlike listUnlisted this exposes the
  // free-text note and the actor, so it must never be reachable without the
  // admin guard. Cleared rows are the audit trail, hence opt-in rather than
  // dropped.
  listRemovals({ includeCleared = false } = {}) {
    return this.client.personProfileRemoval.findMany({
      where: includeCleared ? {} : { clearedAt: null },
      // Active takedowns first (clearedAt null), then most recent within each
      // group. Postgres sorts NULLs last on ASC by default, which would bury
      // exactly the rows an operator opens this list to see.
      orderBy: [
        {
          clearedAt: {
            sort: Prisma.SortOrder.asc,
            nulls: Prisma.NullsOrder.first,
          },
        },
        { requestedAt: Prisma.SortOrder.desc },
      ],
      take: REMOVAL_LIST_CAP,
    })
  }

  // Persists an inbound "claim this profile" lead from the public modal. There
  // is no dedupe/rate-limit here by design — it is raw lead data the growth
  // team follows up on; `personId` is a civics reference, not a FK. `source`
  // records which of the two forms sent it, and is null for callers that
  // predate the discriminator (see the schema comment).
  createClaimRequest(input: CreateProfileClaimRequestInput) {
    return this.client.profileClaimRequest.create({
      data: {
        personId: input.personId,
        requesterEmail: input.requesterEmail,
        requesterName: input.requesterName ?? null,
        marketingConsent: input.marketingConsent,
        source: input.source ?? null,
      },
    })
  }
}
