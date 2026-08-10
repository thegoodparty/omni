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
  // its own table keyed by the civics personId.

  async isRemoved(personId: string): Promise<boolean> {
    const removal = await this.client.personProfileRemoval.findUnique({
      where: { personId },
      select: { personId: true },
    })
    return Boolean(removal)
  }

  // The /people sitemap lists every person page, not just the published
  // overlays, so it needs the removal set to subtract: removed persons render
  // noindex and must not be advertised. Capped like listPublished for the same
  // unbounded-heap reason — truncation is the worse failure here (a removed
  // person past the cap would get advertised), but a sitemap over 50k URLs
  // must shard anyway and takedowns run orders of magnitude below that
  // ceiling.
  listRemoved() {
    return this.client.personProfileRemoval.findMany({
      select: { personId: true, updatedAt: true },
      orderBy: { updatedAt: Prisma.SortOrder.desc },
      take: 50_000,
    })
  }

  // Idempotent set (upsert) — flagging an already-removed person just refreshes
  // the note/timestamp.
  setRemoval(personId: string, note?: string | null) {
    return this.client.personProfileRemoval.upsert({
      where: { personId },
      create: { personId, note: note ?? null },
      update: { note: note ?? null, requestedAt: new Date() },
    })
  }

  async clearRemoval(personId: string): Promise<void> {
    await this.client.personProfileRemoval.deleteMany({ where: { personId } })
  }

  // Persists an inbound "claim this profile" lead from the public modal. There
  // is no dedupe/rate-limit here by design — it is raw lead data the growth
  // team follows up on; `personId` is a civics reference, not a FK.
  createClaimRequest(input: CreateProfileClaimRequestInput) {
    return this.client.profileClaimRequest.create({
      data: {
        personId: input.personId,
        requesterEmail: input.requesterEmail,
        requesterName: input.requesterName ?? null,
        marketingConsent: input.marketingConsent,
      },
    })
  }
}
