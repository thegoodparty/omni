import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type { IssueTag, UpdateIssueTag } from '@goodparty_org/contracts'
import {
  type IssueTag as IssueTagRow,
  IssueTagStatus,
  Prisma,
} from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { cleanTagName, normalizeTagName } from '../util/issueTagName.util'

const WITH_FEEDBACK_COUNT = {
  _count: { select: { feedback: true } },
} as const satisfies Prisma.IssueTagInclude

type CountedTag = Prisma.IssueTagGetPayload<{
  include: typeof WITH_FEEDBACK_COUNT
}>

const toIssueTag = (tag: CountedTag): IssueTag => ({
  id: tag.id,
  name: tag.name,
  status: tag.status,
  source: tag.source,
  declaredTopIssueId: tag.declaredTopIssueId,
  mergedIntoId: tag.mergedIntoId,
  feedbackCount: tag._count.feedback,
})

// The system proposes, a person decides. Synthesis proposes a tag per
// theme; these are the decisions.
@Injectable()
export class IssueTagService extends createPrismaBase(MODELS.IssueTag) {
  async listForOrg(input: {
    organizationSlug: string
    status?: IssueTagStatus
  }): Promise<IssueTag[]> {
    const tags = await this.model.findMany({
      where: {
        organizationSlug: input.organizationSlug,
        ...(input.status === undefined ? {} : { status: input.status }),
      },
      orderBy: { name: Prisma.SortOrder.asc },
      include: WITH_FEEDBACK_COUNT,
    })
    return tags.map(toIssueTag)
  }

  async update(input: {
    organizationSlug: string
    id: string
    body: UpdateIssueTag
  }): Promise<IssueTag> {
    const tag = await this.findFirst({
      where: { id: input.id, organizationSlug: input.organizationSlug },
    })
    if (tag === null) throw new NotFoundException('Tag not found')

    switch (input.body.action) {
      case 'accept':
        // Its memos moved to the tag it was merged into; accepting it again
        // would bring back an empty duplicate.
        if (tag.mergedIntoId !== null) {
          throw new UnprocessableEntityException(
            'A merged tag cannot be accepted',
          )
        }
        return this.write(tag.id, { status: IssueTagStatus.accepted })
      case 'rename':
        // A collision with any other tag in the org, retired ones included,
        // trips the unique index and comes back as a 409.
        return this.write(tag.id, {
          name: cleanTagName(input.body.name),
          normalizedName: normalizeTagName(input.body.name),
        })
      case 'merge':
        await this.merge(tag, input.body.intoTagId)
        return this.read(tag.id)
      case 'retire':
        return this.write(tag.id, { status: IssueTagStatus.retired })
    }
  }

  private async write(
    id: string,
    data: Prisma.IssueTagUpdateInput,
  ): Promise<IssueTag> {
    const tag = await this.model.update({
      where: { id },
      data,
      include: WITH_FEEDBACK_COUNT,
    })
    return toIssueTag(tag)
  }

  private async read(id: string): Promise<IssueTag> {
    const tag = await this.model.findUniqueOrThrow({
      where: { id },
      include: WITH_FEEDBACK_COUNT,
    })
    return toIssueTag(tag)
  }

  // Every memo carrying the source now carries the target, and the themes
  // linked to the source point at the target. The source is retired, not
  // deleted, so its history still reads.
  private async merge(source: IssueTagRow, intoTagId: string): Promise<void> {
    const target = await this.findFirst({
      where: { id: intoTagId, organizationSlug: source.organizationSlug },
    })
    if (target === null) throw new NotFoundException('Merge target not found')
    if (target.id === source.id || target.status !== IssueTagStatus.accepted) {
      throw new UnprocessableEntityException(
        'A tag can only be merged into another accepted tag',
      )
    }

    await this.client.$transaction(async (tx) => {
      const rows = await tx.constituentFeedbackTag.findMany({
        where: { tagId: source.id },
      })
      // A memo already carrying the target keeps its own row for it.
      await tx.constituentFeedbackTag.createMany({
        data: rows.map((row) => ({
          feedbackId: row.feedbackId,
          tagId: target.id,
          runId: row.runId,
        })),
        skipDuplicates: true,
      })
      await tx.constituentFeedbackTag.deleteMany({
        where: { tagId: source.id },
      })
      await tx.feedbackTheme.updateMany({
        where: { tagId: source.id },
        data: { tagId: target.id },
      })
      // Tags merged into the source earlier follow it, so a merge pointer
      // always lands on a live tag rather than starting a chain.
      await tx.issueTag.updateMany({
        where: { mergedIntoId: source.id },
        data: { mergedIntoId: target.id },
      })
      await tx.issueTag.update({
        where: { id: source.id },
        data: { status: IssueTagStatus.retired, mergedIntoId: target.id },
      })
    })
  }
}
