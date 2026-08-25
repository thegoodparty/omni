import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ContactNote, Prisma, User } from '../../generated/prisma'

const ACTOR_INCLUDE = {
  actor: { select: { firstName: true, lastName: true } },
} satisfies Prisma.ContactNoteInclude

export type ContactNoteWithActor = ContactNote & {
  actor: Pick<User, 'firstName' | 'lastName'> | null
}

@Injectable()
export class ContactNoteService extends createPrismaBase(MODELS.ContactNote) {
  create(
    organizationSlug: string,
    personId: string,
    body: string,
    actorUserId: number,
  ): Promise<ContactNoteWithActor> {
    return this.model.create({
      data: { organizationSlug, personId, body, actorUserId },
      include: ACTOR_INCLUDE,
    })
  }

  listForPerson(
    organizationSlug: string,
    personId: string,
  ): Promise<ContactNoteWithActor[]> {
    return this.findMany({
      where: { organizationSlug, personId },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      include: ACTOR_INCLUDE,
    })
  }

  async updateByIdAndOrganizationSlug(
    id: string,
    organizationSlug: string,
    body: string,
    actorUserId: number,
  ): Promise<ContactNoteWithActor | null> {
    const [note] = await this.model.updateManyAndReturn({
      where: { id, organizationSlug },
      data: { body, actorUserId },
      include: ACTOR_INCLUDE,
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
