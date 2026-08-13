import { Injectable, NotFoundException } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'

@Injectable()
export class OrdinanceCodeReadService extends createPrismaBase(
  MODELS.OrdinanceCodeRecord,
) {
  // Non-owners get the same 404 as a missing record so the endpoint does not
  // leak which organizations exist — same posture as GET /organizations/:slug.
  async getForOwner(userId: number, organizationSlug: string) {
    const record = await this.findFirst({
      where: { organizationSlug, organization: { ownerId: userId } },
    })
    if (!record) {
      throw new NotFoundException('Ordinance code record not found')
    }
    return record
  }
}
