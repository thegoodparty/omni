import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  RecordPhoneBankingCall,
  RecordPhoneBankingCallResponse,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { mapWillVoteToLikelihood } from '@/contactInteraction/services/contactInteractionDoorKnock.service'
import {
  ContactInteractionPhoneBanking,
  ContactStatusField,
  ContactStatusSource,
  OutreachStatus,
  PhoneBankCallOutcome,
  Prisma,
  SupportAnswer,
  WillVoteAnswer,
} from '../../generated/prisma'

type EntryWithPersons = Prisma.PhoneBankingListEntryGetPayload<{
  include: { persons: true }
}>

type RowInput = {
  organizationSlug: string
  phoneBankingListId: number
  personId: string
  occurredAt: Date
  outcome: PhoneBankCallOutcome
  supportAnswer: SupportAnswer | null
  willVote: WillVoteAnswer | null
  note: string | null
}

// Two-int form of pg_advisory_xact_lock: (namespace, listId). 'pb' in ASCII.
// Serializes call-outcome writes per list, mirroring doorKnocking's
// lockTurf: envelope completion reads "does every person have a row?" and
// two concurrent callers each logging one of the last two un-logged people
// would otherwise each see the other's write as still-missing (neither's
// snapshot includes the other's uncommitted insert) and neither would flip
// the envelope. The lock makes the second caller's check run only after the
// first's insert has committed.
const PHONE_BANKING_LIST_LOCK_NAMESPACE = 25714

@Injectable()
export class PhoneBankingCallService extends createPrismaBase(
  MODELS.ContactInteractionPhoneBanking,
) {
  constructor(private readonly contactStatus: ContactStatusService) {
    super()
  }

  async recordCall(
    listId: number,
    organizationSlug: string,
    input: RecordPhoneBankingCall,
  ): Promise<RecordPhoneBankingCallResponse> {
    const list = await this.client.phoneBankingList.findFirst({
      where: { id: listId, organizationSlug },
      select: { id: true },
    })
    if (!list) {
      throw new NotFoundException('Phone banking list not found')
    }

    const entry = await this.client.phoneBankingListEntry.findFirst({
      where: { id: input.entryId, phoneBankingListId: listId },
      include: { persons: true },
    })
    if (!entry) {
      throw new NotFoundException('Phone banking list entry not found')
    }
    if (
      input.personId !== undefined &&
      !entry.persons.some((person) => person.personId === input.personId)
    ) {
      throw new NotFoundException('Person not on this entry')
    }

    const occurredAt = new Date()
    const { rows, envelopeCompleted } = await this.client.$transaction((tx) =>
      this.applyOutcome(tx, organizationSlug, listId, entry, input, occurredAt),
    )

    // The DB-level upserts above are done; the likelihood override write has
    // its own transaction (ContactStatusService.changeStatus) and Prisma
    // rejects nesting one $transaction inside another, so it runs after
    // this one commits — same order door-knocking's create()/
    // recordIdempotent() use.
    await this.emitLikelihoodEvents(rows)

    return {
      entryId: entry.id,
      results: rows.map((row) => ({
        personId: row.personId,
        interaction: {
          outcome: row.outcome,
          supportAnswer: row.supportAnswer,
          willVote: row.willVote,
          occurredAt: row.occurredAt,
        },
      })),
      envelopeCompleted,
    }
  }

  private async applyOutcome(
    tx: Prisma.TransactionClient,
    organizationSlug: string,
    listId: number,
    entry: EntryWithPersons,
    input: RecordPhoneBankingCall,
    occurredAt: Date,
  ): Promise<{
    rows: ContactInteractionPhoneBanking[]
    envelopeCompleted: boolean
  }> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PHONE_BANKING_LIST_LOCK_NAMESPACE}::int, ${listId}::int)`

    const rows: ContactInteractionPhoneBanking[] = []

    // Zod's refine on RecordPhoneBankingCallSchema already enforces this
    // at the controller boundary; the check here is for TS narrowing.
    if (
      input.outcome === PhoneBankCallOutcome.answered &&
      input.personId === undefined
    ) {
      throw new BadRequestException(
        'personId is required when outcome is answered',
      )
    }

    // personId present = person-attributed: an answered conversation, or a
    // `refused` that means "answered but refused to engage" (logged on the
    // person who picked up, never fanned out). personId absent = a
    // number-level dial result that fans out to the whole household.
    if (input.personId !== undefined) {
      const { personId } = input
      rows.push(
        await this.upsertRow(tx, {
          organizationSlug,
          phoneBankingListId: listId,
          personId,
          occurredAt,
          outcome: input.outcome,
          supportAnswer: input.supportAnswer ?? null,
          willVote: input.willVote ?? null,
          note: input.note ?? null,
        }),
      )

      if (input.markHouseholdDone) {
        rows.push(
          ...(await this.fillHouseholdDone(
            tx,
            organizationSlug,
            listId,
            entry,
            personId,
            occurredAt,
          )),
        )
      }
    } else {
      for (const person of entry.persons) {
        rows.push(
          await this.upsertRow(tx, {
            organizationSlug,
            phoneBankingListId: listId,
            personId: person.personId,
            occurredAt,
            outcome: input.outcome,
            supportAnswer: null,
            willVote: null,
            note: input.note ?? null,
          }),
        )
      }

      if (input.outcome === PhoneBankCallOutcome.wrong_number) {
        await tx.phoneBankingSuppressedPhone.upsert({
          where: {
            organizationSlug_phone: { organizationSlug, phone: entry.phone },
          },
          create: { organizationSlug, phone: entry.phone },
          update: {},
        })
      }
    }

    const envelopeCompleted = await this.maybeCompleteEnvelope(tx, listId)
    return { rows, envelopeCompleted }
  }

  // Fills bare `answered` rows for the entry's other household members,
  // skipping anyone who already has a logged row (any outcome) on this
  // list. `skipDuplicates` makes the "don't overwrite an existing row"
  // check atomic with the write itself — a separate read-then-write would
  // leave a window for a concurrent direct answer on the same person to be
  // clobbered by this bare fill. The caller (a household member's own
  // answer may not have made it back to the UI yet) expects every
  // household member's current row in the response, not just the ones
  // this call happened to insert, so this reads the household back after
  // the write instead of returning `createMany`'s insert-only result.
  private async fillHouseholdDone(
    tx: Prisma.TransactionClient,
    organizationSlug: string,
    listId: number,
    entry: EntryWithPersons,
    excludePersonId: string,
    occurredAt: Date,
  ): Promise<ContactInteractionPhoneBanking[]> {
    const householdPersonIds = entry.persons
      .map((person) => person.personId)
      .filter((personId) => personId !== excludePersonId)
    if (householdPersonIds.length === 0) return []

    await tx.contactInteractionPhoneBanking.createMany({
      data: householdPersonIds.map((personId) => ({
        organizationSlug,
        phoneBankingListId: listId,
        personId,
        occurredAt,
        outcome: PhoneBankCallOutcome.answered,
        supportAnswer: null,
        willVote: null,
        note: null,
      })),
      skipDuplicates: true,
    })

    return tx.contactInteractionPhoneBanking.findMany({
      where: {
        phoneBankingListId: listId,
        personId: { in: householdPersonIds },
      },
    })
  }

  private upsertRow(
    tx: Prisma.TransactionClient,
    data: RowInput,
  ): Promise<ContactInteractionPhoneBanking> {
    const { phoneBankingListId, personId, ...rest } = data
    return tx.contactInteractionPhoneBanking.upsert({
      where: { phoneBankingListId_personId: { phoneBankingListId, personId } },
      create: { phoneBankingListId, personId, ...rest },
      update: rest,
    })
  }

  // Entry counts as called when any person is logged; the envelope needs
  // every person on every entry logged. Rows are one-per-(list, person)
  // (the @@unique), so a plain row count doubles as a distinct-person
  // count. A Serve org (no campaign) or a list without an envelope simply
  // has nothing to flip. Once completed, this never re-checks (ratchet).
  private async maybeCompleteEnvelope(
    tx: Prisma.TransactionClient,
    listId: number,
  ): Promise<boolean> {
    const outreach = await tx.outreach.findUnique({
      where: { phoneBankingListId: listId },
      select: { id: true, status: true },
    })
    if (!outreach) return false
    if (outreach.status === OutreachStatus.completed) return true

    const [totalPersons, loggedCount] = await Promise.all([
      tx.phoneBankingListEntryPerson.count({
        where: { entry: { phoneBankingListId: listId } },
      }),
      tx.contactInteractionPhoneBanking.count({
        where: { phoneBankingListId: listId },
      }),
    ])
    if (loggedCount < totalPersons) return false

    await tx.outreach.update({
      where: { id: outreach.id },
      data: { status: OutreachStatus.completed },
    })
    return true
  }

  // Shared willVote->voter_likelihood mapping and eo- skip with
  // door-knocking (ContactInteractionDoorKnockService.emitLikelihoodEvent).
  // Unlike door-knocking's sourceId (stable per synced knock, so a replay
  // no-ops), this mints per save from (interactionId, updatedAt) — a
  // corrected answer is first-class here and must record a new event.
  private async emitLikelihoodEvents(
    rows: ContactInteractionPhoneBanking[],
  ): Promise<void> {
    for (const row of rows) {
      const toValue = mapWillVoteToLikelihood(row.willVote)
      if (!toValue) continue
      if (row.organizationSlug.startsWith('eo-')) continue
      await this.contactStatus.changeStatus({
        organizationSlug: row.organizationSlug,
        personId: row.personId,
        field: ContactStatusField.voter_likelihood,
        toValue,
        source: ContactStatusSource.phone_banking,
        actorUserId: null,
        sourceId: `${row.id}:${row.updatedAt.toISOString()}`,
        fallbackFromValue: null,
      })
    }
  }
}
