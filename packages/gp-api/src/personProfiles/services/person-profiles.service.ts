import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { Prisma } from '../../generated/prisma'
import {
  ProfileIssueInput,
  UpsertPersonProfileInput,
} from '../schemas/personProfile.schema'

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
  listPublished() {
    return this.model.findMany({
      where: { publishedAt: { not: null }, deletedAt: null },
      select: { personId: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
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
    const { accomplishments, ...rest } = data
    return this.model.create({
      data: {
        userId,
        personId,
        ...rest,
        // A fresh profile with no accomplishments simply leaves the column null.
        ...(accomplishments != null ? { accomplishments } : {}),
      },
      include: withIssues,
    })
  }

  updateForUser(userId: number, data: UpsertPersonProfileInput) {
    const { accomplishments, ...rest } = data
    return this.model.update({
      where: { userId },
      data: {
        ...rest,
        // Explicit null clears the JSON column; undefined leaves it untouched.
        ...(accomplishments !== undefined
          ? { accomplishments: accomplishments ?? Prisma.DbNull }
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
  async replaceIssues(personProfileId: string, issues: ProfileIssueInput[]) {
    await this.client.$transaction([
      this.client.personProfileIssue.deleteMany({
        where: { personProfileId },
      }),
      this.client.personProfileIssue.createMany({
        data: issues.map((issue) => ({
          personProfileId,
          issueId: issue.issueId,
          visible: issue.visible ?? true,
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
}
