import { Injectable } from '@nestjs/common'
import {
  ArtifactReviewResourceType,
  ArtifactReviewVerdict,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'

type SetVerdictInput = {
  resourceType: ArtifactReviewResourceType
  resourceId: string
  verdict: ArtifactReviewVerdict
  failReason: string | null
  reviewerClerkSub: string
  reviewerEmail: string | null
}

@Injectable()
export class ArtifactReviewService extends createPrismaBase(
  MODELS.ArtifactReview,
) {
  setVerdict({ resourceType, resourceId, ...verdictFields }: SetVerdictInput) {
    return this.model.upsert({
      where: {
        resourceType_resourceId: { resourceType, resourceId },
      },
      create: { resourceType, resourceId, ...verdictFields },
      update: verdictFields,
    })
  }

  findForResources(
    resourceType: ArtifactReviewResourceType,
    resourceIds: string[],
  ) {
    return this.model.findMany({
      where: { resourceType, resourceId: { in: resourceIds } },
    })
  }
}
