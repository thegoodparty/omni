import { Injectable } from '@nestjs/common'
import { ContactStatusField, ContactStatusSource } from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'

export type ChangeStatusInput = {
  organizationSlug: string
  personId: string
  field: ContactStatusField
  fromValue: string | null
  toValue: string
  source: ContactStatusSource
  actorUserId: number | null
  sourceId?: string | null
}

@Injectable()
export class ContactStatusService extends createPrismaBase(
  MODELS.ContactCurrentStatus,
) {
  // Event insert + current-state upsert in one transaction, so a reader can
  // never observe an event with no matching current-state row (or vice
  // versa). Callers decide whether a write is a no-op (unchanged value) —
  // this always writes what it's given.
  async changeStatus(input: ChangeStatusInput) {
    const {
      organizationSlug,
      personId,
      field,
      fromValue,
      toValue,
      source,
      actorUserId,
      sourceId,
    } = input
    return this.client.$transaction(async (tx) => {
      const event = await tx.contactStatusEvent.create({
        data: {
          organizationSlug,
          personId,
          field,
          fromValue,
          toValue,
          source,
          actorUserId,
          sourceId: sourceId ?? null,
        },
      })
      await tx.contactCurrentStatus.upsert({
        where: {
          organizationSlug_personId_field: {
            organizationSlug,
            personId,
            field,
          },
        },
        create: { organizationSlug, personId, field, value: toValue },
        update: { value: toValue },
      })
      return event
    })
  }

  // Batched for a single person by every caller today (findPerson) but
  // written for lists — a future filter-detail/list caller passes many ids
  // in one query instead of N.
  async currentStatusForPeople(
    organizationSlug: string,
    field: ContactStatusField,
    personIds: string[],
  ): Promise<Map<string, string>> {
    if (personIds.length === 0) {
      return new Map()
    }
    const rows = await this.model.findMany({
      where: { organizationSlug, field, personId: { in: personIds } },
      select: { personId: true, value: true },
    })
    return new Map(rows.map((row) => [row.personId, row.value]))
  }

  // Mirrors SupportStatusService.personIdsByStatus. Unlike support status,
  // every value here (including "no override") is a real override row or
  // nothing at all — there's no "unknown = has interaction rows with a null
  // answer" case to special-case, so a plain `in` lookup is exact.
  async personIdsByFieldValue(
    organizationSlug: string,
    field: ContactStatusField,
    values: string[],
  ): Promise<string[]> {
    if (values.length === 0) {
      return []
    }
    const rows = await this.model.findMany({
      where: { organizationSlug, field, value: { in: values } },
      select: { personId: true },
    })
    return rows.map((row) => row.personId)
  }
}
