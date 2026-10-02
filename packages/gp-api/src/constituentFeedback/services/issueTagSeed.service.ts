import { Injectable } from '@nestjs/common'
import { IssueTagSource, IssueTagStatus } from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { cleanTagName, normalizeTagName } from '../util/issueTagName.util'

// Win only. A candidate declared positions at signup, so a Win org's first
// run starts from those as accepted tags, and synthesis reuses one whenever
// a theme matches. Named after the specific position, not its category:
// category names pull matching toward buckets too broad for what people
// actually say. The category id stays on the tag for the declared-versus-
// heard comparison. Serve has no declared positions and starts empty.
@Injectable()
export class IssueTagSeedService extends createPrismaBase(MODELS.IssueTag) {
  async seedFromPositions(organizationSlug: string): Promise<number> {
    const positions = await this.client.campaignPosition.findMany({
      where: { campaign: { organizationSlug } },
      select: {
        topIssueId: true,
        position: { select: { name: true, topIssueId: true } },
      },
    })

    // skipDuplicates on (organizationSlug, normalizedName) is the
    // idempotence: a name the org already has, in any status, is left as
    // it is.
    const { count } = await this.model.createMany({
      data: positions.map(({ position, topIssueId }) => ({
        organizationSlug,
        name: cleanTagName(position.name),
        normalizedName: normalizeTagName(position.name),
        status: IssueTagStatus.accepted,
        source: IssueTagSource.seed,
        declaredTopIssueId: position.topIssueId ?? topIssueId,
      })),
      skipDuplicates: true,
    })
    return count
  }
}
