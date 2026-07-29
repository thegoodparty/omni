import { Injectable } from '@nestjs/common'
import {
  ContactStatusEvent,
  ContactStatusField,
  ContactStatusSource,
  Prisma,
  User,
} from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { retryIf } from '@/shared/util/retry-if'

export type ChangeStatusInput = {
  organizationSlug: string
  personId: string
  field: ContactStatusField
  toValue: string
  source: ContactStatusSource
  actorUserId: number | null
  // Idempotency key for activity-sourced writes (door-knock sync, later
  // phone-banking). A conflict on the unique (organizationSlug, field,
  // sourceId) resolves to a silent no-op (this call returns null) rather than
  // throwing — a re-synced/replayed activity event must not fail the
  // caller's interaction write. Omit for manual edits.
  sourceId?: string | null
  // The derived/seed value the caller observed via its own (unlocked) read,
  // used ONLY when no current-state row exists yet for this (org, personId,
  // field) — there's nothing to lock in that case. Advisory: whenever a row
  // DOES exist, the authoritative fromValue is read from it inside this
  // method's own transaction instead, so two writers racing on the same
  // (org, personId, field) can't both record the same stale fromValue.
  fallbackFromValue: string | null
}

// First-ever-write race sentinel (mirrors OwnershipLostError in
// ordinanceQualityLoop.service.ts): thrown when two concurrent changeStatus
// calls both find no current-state row to lock and both attempt to create
// one — the loser hits the (organizationSlug, personId, field) unique
// constraint. Caught only around that specific insert, never around the
// event insert, so a genuine duplicate sourceId (contact_status_event's own
// unique) still propagates as a real Prisma error instead of being retried.
class CurrentStatusRaceError extends Error {}

// The activity feed (ContactEngagementService, ENG-10835) always needs the
// writer's name alongside each event — this is the one shape it reads.
export type ContactStatusEventWithActor = ContactStatusEvent & {
  actor: Pick<User, 'firstName' | 'lastName'> | null
}

@Injectable()
export class ContactStatusService extends createPrismaBase(
  MODELS.ContactCurrentStatus,
) {
  // Decide-and-write must be atomic: a read-then-conditionally-write split
  // across two calls lets two racing PATCHes for the same (org, personId,
  // field) both read the pre-write value and both record it as fromValue,
  // corrupting the append-only history. `FOR UPDATE` locks the current-state
  // row for the transaction's lifetime, serializing concurrent writers so
  // each sees the previous writer's committed value.
  async changeStatus(input: ChangeStatusInput) {
    return retryIf(() => this.attemptChangeStatus(input), {
      shouldRetry: (err) => err instanceof CurrentStatusRaceError,
      retries: 1,
    })
  }

  private async attemptChangeStatus(input: ChangeStatusInput) {
    const {
      organizationSlug,
      personId,
      field,
      toValue,
      source,
      actorUserId,
      sourceId,
      fallbackFromValue,
    } = input
    return this.client.$transaction(async (tx) => {
      const [existing] = await tx.$queryRaw<{ value: string }[]>(Prisma.sql`
        SELECT value FROM contact_current_status
        WHERE organization_slug = ${organizationSlug}
          AND person_id = ${personId}
          AND field::text = ${field}
        FOR UPDATE
      `)

      const fromValue = existing?.value ?? fallbackFromValue
      if (fromValue === toValue) {
        return null
      }

      let event: ContactStatusEvent
      try {
        event = await tx.contactStatusEvent.create({
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
      } catch (err) {
        // Activity-sourced callers (door-knock sync, later phone-banking) pass
        // a stable sourceId so a re-synced/replayed write is a no-op, not an
        // error that fails the caller's interaction write. This constraint
        // can only fire when sourceId is non-null — Postgres treats NULLs as
        // distinct, so manual edits (null sourceId) never collide on it.
        if (sourceId && isUniqueConstraintError(err)) {
          return null
        }
        throw err
      }

      if (existing) {
        await tx.contactCurrentStatus.updateMany({
          where: { organizationSlug, personId, field },
          data: { value: toValue },
        })
        return event
      }

      try {
        await tx.contactCurrentStatus.create({
          data: { organizationSlug, personId, field, value: toValue },
        })
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          throw new CurrentStatusRaceError()
        }
        throw err
      }
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

  // This service owns ContactStatusEvent's only writer (attemptChangeStatus
  // above), so the feed read path lives here too rather than a second
  // model-bound service. `this.model`/the base class's passthroughs are
  // bound to ContactCurrentStatus, not ContactStatusEvent — hence the raw
  // `this.client` call instead of `this.findMany`.
  async findEventsForFeed(
    args: Prisma.ContactStatusEventFindManyArgs,
  ): Promise<ContactStatusEventWithActor[]> {
    return this.client.contactStatusEvent.findMany({
      ...args,
      include: { actor: { select: { firstName: true, lastName: true } } },
    })
  }
}
