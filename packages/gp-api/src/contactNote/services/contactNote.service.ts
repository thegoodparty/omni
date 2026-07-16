import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { Prisma } from '../../generated/prisma'

@Injectable()
export class ContactNoteService extends createPrismaBase(MODELS.ContactNote) {
  create(organizationSlug: string, personId: string, body: string) {
    return this.model.create({
      data: { organizationSlug, personId, body },
    })
  }

  listForPerson(organizationSlug: string, personId: string) {
    return this.findMany({
      where: { organizationSlug, personId },
      orderBy: { createdAt: Prisma.SortOrder.desc },
    })
  }

  async updateByIdAndOrganizationSlug(
    id: string,
    organizationSlug: string,
    body: string,
  ) {
    const [note] = await this.model.updateManyAndReturn({
      where: { id, organizationSlug },
      data: { body },
    })
    return note ?? null
  }

  async deleteByIdAndOrganizationSlug(id: string, organizationSlug: string) {
    const { count } = await this.model.deleteMany({
      where: { id, organizationSlug },
    })
    return count
  }
}
