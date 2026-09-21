import { Injectable, NotFoundException } from '@nestjs/common'
import pmap from 'p-map'
import { serializeError } from 'serialize-error'
import { v5 as uuidv5 } from 'uuid'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import {
  Organization,
  OutreachStatus,
  PollIndividualMessageSender,
  Prisma,
} from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { phoneDigitsKey } from '@/shared/util/strings.util'
import { isOptOutMessage } from '../util/textOptOut.util'

/**
 * The shared delivery layer's inbound half. One writer, two producers: SMS
 * rows are parsed straight out of the staff upload, poll rows come back from
 * the analysis pipeline's artifact after the same upload has been through it.
 * Neither producer is visible to whoever uploaded the file.
 *
 * Nothing in here is product-specific. Polls adds a step on top that writes
 * themes; SMS never clusters at all.
 *
 * See docs/features/serve-sms.md, "Layer 1: Delivery", Inbound.
 */

export interface IngestReplyRow {
  phone: string
  content: string
  receivedAt?: Date
}

export interface IngestRepliesInput {
  outreachId: number
  rows: IngestReplyRow[]
  /** Which producer, for the audit trail. */
  sourceLabel: 'staff_upload' | 'analysis_pipeline'
  /**
   * Parse and report without writing. The staff upload page runs a dry run
   * first and shows the counts before committing, because silent partial
   * failure is the failure mode of the path it replaces.
   */
  dryRun?: boolean
}

export interface IngestRepliesResult {
  rowsParsed: number
  matched: number
  /** Rows whose number belongs to nobody on this send. Logged, never thrown. */
  unmatched: number
  optOuts: number
  committed: boolean
}

// Distinct from POLL_INDIVIDUAL_MESSAGE_NAMESPACE so the two id spaces can
// never collide, and so this layer carries no import from src/polls.
const OUTREACH_TEXT_MESSAGE_NAMESPACE =
  'f3b7c6d2-5a41-4e2b-9c8f-6d0a1b2c3d4e' as const

// Bound the People-DB fan-out the same way the poll handler does: a large
// send must not burst hundreds of simultaneous requests at people-api.
const PEOPLE_LOOKUP_CONCURRENCY = 20

// The delete-then-create pass runs over a whole send's replies in one
// transaction; match the poll handler's ceiling rather than the 5s default.
const INGEST_TRANSACTION_TIMEOUT_MS = 20_000

// One reply, after the analysis pipeline has split a compound message into
// atoms. A direct upload always produces groups of one.
interface ReplyGroup {
  /** Bare 10 digits — the comparison key across every phone shape. */
  phoneDigits: string
  receivedAt?: Date
  rows: IngestReplyRow[]
}

// One message row under construction, keyed by its deterministic id. Several
// ReplyGroups can merge into one of these — see the merge note below.
interface PendingMessage {
  id: string
  personId: string
  phoneDigits: string
  receivedAt?: Date
  rows: IngestReplyRow[]
}

@Injectable()
export class OutreachTextIngestService extends createPrismaBase(
  MODELS.Outreach,
) {
  constructor(
    private readonly textInteractions: ContactInteractionTextService,
    private readonly contactsService: ContactsService,
  ) {
    super()
  }

  /**
   * Map phone to person, write the message rows, and apply reply/opt-out
   * events onto ContactInteractionText.
   *
   * Two invariants worth keeping when this is filled in:
   *  - An unattributable reply is skipped and logged, never thrown. Throwing
   *    bubbles to SQS and redelivers forever, blocking every other reply in
   *    the batch.
   *  - Opt-out is decided by one predicate in this layer, applied to every
   *    row regardless of producer. The pipeline's own isOptOut flag is a
   *    hint, not the source of truth, or the two definitions drift.
   *
   * The second invariant is why IngestReplyRow carries no opt-out field:
   * a producer hands over the message text and this layer decides. See
   * outreach/util/textOptOut.util.ts.
   */
  async ingestReplies(input: IngestRepliesInput): Promise<IngestRepliesResult> {
    const { outreachId, rows, sourceLabel, dryRun = false } = input

    // A missing envelope is a caller bug, not an unattributable row: the
    // skip-and-log posture below is about individual replies. The staff
    // upload page needs this reported, and a queue producer that invents an
    // outreach id would loop forever on any other answer.
    const outreach = await this.model.findUnique({
      where: { id: outreachId },
      select: {
        id: true,
        status: true,
        organizationSlug: true,
        campaign: { select: { organizationSlug: true } },
      },
    })
    if (!outreach) {
      throw new NotFoundException(`Outreach ${outreachId} not found`)
    }
    // Win rows scope by campaign, Serve rows by organization; the delivery
    // layer serves both.
    const organizationSlug =
      outreach.organizationSlug ?? outreach.campaign?.organizationSlug ?? null

    // --- 1. Group by (phone, receivedAt) --------------------------------
    const { groups, unparseablePhoneRows } = this.groupRows(
      outreachId,
      rows,
      sourceLabel,
    )

    // --- 2. Phone -> personId -------------------------------------------
    const phoneToPersonId = await this.resolvePersonIds(
      outreachId,
      organizationSlug,
      [...new Set([...groups.values()].map((group) => group.phoneDigits))],
    )

    // The message rows carry the office for the constituent timeline's
    // reader. Serve orgs have exactly one (organizationSlug is unique on
    // ElectedOffice); a Win campaign has none, and null is correct there.
    const electedOfficeId = organizationSlug
      ? ((
          await this.client.electedOffice.findUnique({
            where: { organizationSlug },
            select: { id: true },
          })
        )?.id ?? null)
      : null

    // --- 3 & 4. Opt-out predicate, deterministic message rows ------------
    // Two groups can land on one id: the id is (outreachId, personId,
    // receivedAt), so two phones resolving to the same person at the same
    // instant collide — and when a producer omits receivedAt (it is optional
    // in the contract) EVERY reply from that person collides, because the
    // timestamp component is empty for all of them. Colliding groups are
    // MERGED into the single row that id names rather than one being
    // discarded: dropping a group would silently discard an opt-out while
    // the result still counted it, and an opt-out is the one row that must
    // never be lost. Merge is also why the counts below are taken from the
    // merged set, not from the loop.
    const pending = new Map<string, PendingMessage>()
    let matched = 0
    let unmatched = unparseablePhoneRows

    for (const group of groups.values()) {
      const personId = phoneToPersonId.get(group.phoneDigits)
      if (!personId) {
        // Throwing here would bubble back to SQS and redeliver forever
        // (see queue/CLAUDE.md), blocking every other reply in the batch.
        // A single unattributable reply is the lesser evil — drop it, keep
        // a record in the logs, and report it in the counts.
        unmatched += group.rows.length
        this.logger.warn(
          { outreachId, sourceLabel, phone: group.phoneDigits },
          'Skipping reply: phone not on this send and not found in People DB',
        )
        continue
      }
      // Every attributed row is represented in the merged set, so this
      // still holds: matched + unmatched === rowsParsed.
      matched += group.rows.length

      const id = uuidv5(
        `${outreachId}-${personId}-${this.receivedAtKey(group.receivedAt)}`,
        OUTREACH_TEXT_MESSAGE_NAMESPACE,
      )
      const existing = pending.get(id)
      if (existing) {
        existing.rows.push(...group.rows)
        continue
      }
      pending.set(id, {
        id,
        personId,
        phoneDigits: group.phoneDigits,
        receivedAt: group.receivedAt,
        rows: [...group.rows],
      })
    }

    const now = new Date()
    const messages: Prisma.PollIndividualMessageCreateManyInput[] = [
      ...pending.values(),
    ].map((entry) => ({
      id: entry.id,
      personId: entry.personId,
      // The first phone this person answered from; a merged row can span
      // two, and the recipient map is the record of which were on the send.
      personCellPhone: `+1${entry.phoneDigits}`,
      sentAt: entry.receivedAt ?? now,
      // One predicate, every producer, every atom of a split or merged reply.
      isOptOut: entry.rows.some((row) => isOptOutMessage(row.content)),
      sender: PollIndividualMessageSender.CONSTITUENT,
      content: this.mergedContent(entry.rows),
      electedOfficeId,
      // The XOR the DB CHECK enforces: a text outreach's message never
      // carries a pollId.
      outreachId,
    }))
    // Counted off the rows actually written, so the upload preview can never
    // promise staff an opt-out that no row records.
    const optOuts = messages.filter((message) => message.isOptOut).length

    if (dryRun) {
      this.logger.info(
        {
          outreachId,
          sourceLabel,
          rowsParsed: rows.length,
          matched,
          unmatched,
          optOuts,
        },
        '[Outreach Ingest] dry run — nothing written',
      )
      return {
        rowsParsed: rows.length,
        matched,
        unmatched,
        optOuts,
        committed: false,
      }
    }

    // Idempotency: delete the exact ids we are about to write, then write
    // them. The ids are deterministic, so a redelivered queue message or a
    // re-analysis replaces its own rows and touches nothing else. Scoped to
    // CONSTITUENT so an outbound row could never be swept up.
    if (messages.length > 0) {
      await this.client.$transaction(
        async (tx) => {
          await tx.pollIndividualMessage.deleteMany({
            where: {
              id: { in: messages.map((message) => message.id) },
              outreachId,
              sender: PollIndividualMessageSender.CONSTITUENT,
            },
          })
          await tx.pollIndividualMessage.createMany({ data: messages })
        },
        { timeout: INGEST_TRANSACTION_TIMEOUT_MS },
      )
    }

    // --- 5. CRM write-back ----------------------------------------------
    await this.applyInboundEvents(outreachId, messages)

    // --- 6. Spine status, CAS-guarded ------------------------------------
    // Only on an ingest that actually recorded something. An upload whose
    // every row failed to match is a mis-parse or the wrong file, and the
    // CAS is one-way: completing on zero rows would leave the send reading
    // "completed" with no data and no way for a corrected re-upload to fix
    // it, because the guard would never match again.
    const advanced =
      messages.length > 0
        ? await this.model.updateMany({
            where: { id: outreachId, status: OutreachStatus.in_progress },
            data: { status: OutreachStatus.completed },
          })
        : { count: 0 }

    this.logger.info(
      {
        outreachId,
        sourceLabel,
        rowsParsed: rows.length,
        matched,
        unmatched,
        optOuts,
        messagesWritten: messages.length,
        statusAdvanced: advanced.count > 0,
      },
      '[Outreach Ingest] replies committed',
    )

    return {
      rowsParsed: rows.length,
      matched,
      unmatched,
      optOuts,
      committed: true,
    }
  }

  // A reply that arrives without a timestamp still needs a stable id, or a
  // re-upload of the same file duplicates every row. The empty key is that
  // stability; sentAt falls back to wall-clock at write time instead.
  private receivedAtKey(receivedAt?: Date): string {
    return receivedAt ? receivedAt.toISOString() : ''
  }

  // The pipeline repeats the original message on every atom it split out, so
  // the distinct set collapses to one and this matches what the poll handler
  // stores. A producer that hands over genuinely different atoms — or a
  // merge of two groups onto one id — keeps all of them rather than silently
  // losing everything after the first.
  private mergedContent(rows: IngestReplyRow[]): string | null {
    const distinct = [
      ...new Set(rows.map((row) => row.content).filter(Boolean)),
    ]
    return distinct.length > 0 ? distinct.join(' ') : null
  }

  /**
   * Step 1. One reply can span several rows once the analysis pipeline
   * splits a compound message; a direct upload never does, and grouping is
   * harmless there.
   */
  private groupRows(
    outreachId: number,
    rows: IngestReplyRow[],
    sourceLabel: string,
  ): { groups: Map<string, ReplyGroup>; unparseablePhoneRows: number } {
    const groups = new Map<string, ReplyGroup>()
    let unparseablePhoneRows = 0

    for (const row of rows) {
      // Unlike normalizePhoneNumber, this never throws: a junk cell in an
      // uploaded CSV is an unattributable row, not a failed ingest.
      const phoneDigits = phoneDigitsKey(row.phone)
      if (!phoneDigits) {
        unparseablePhoneRows += 1
        this.logger.warn(
          { outreachId, sourceLabel },
          'Skipping reply: phone could not be normalized to a US number',
        )
        continue
      }
      const key = `${phoneDigits}\n${this.receivedAtKey(row.receivedAt)}`
      const existing = groups.get(key)
      if (existing) {
        existing.rows.push(row)
      } else {
        groups.set(key, {
          phoneDigits,
          receivedAt: row.receivedAt,
          rows: [row],
        })
      }
    }

    return { groups, unparseablePhoneRows }
  }

  /**
   * Step 2. The recipient map first, then the People DB for anything it
   * does not cover.
   */
  private async resolvePersonIds(
    outreachId: number,
    organizationSlug: string | null,
    phoneDigits: string[],
  ): Promise<Map<string, string>> {
    const phoneToPersonId = new Map<string, string>()
    if (phoneDigits.length === 0) return phoneToPersonId

    // Read the whole send's map rather than filtering on the reply phones:
    // the comparison key is bare digits and the stored shape is whatever
    // the outbound half wrote, so an `in` on guessed spellings would miss
    // silently. One indexed read per ingest, bounded by the recipient cap.
    const recipients = await this.client.outreachTextRecipient.findMany({
      where: { outreachId },
      select: { personId: true, phone: true },
    })
    const wanted = new Set(phoneDigits)
    for (const recipient of recipients) {
      const key = phoneDigitsKey(recipient.phone)
      if (key && wanted.has(key) && !phoneToPersonId.has(key)) {
        phoneToPersonId.set(key, recipient.personId)
      }
    }

    // Some reply phones were never on the send — most often because the
    // recipient forwarded the message and somebody else answered. Resolve
    // those against the org's district so the reply still lands on a real
    // constituent. Anything still unresolved is skipped by the caller.
    const unmapped = phoneDigits.filter(
      (digits) => !phoneToPersonId.has(digits),
    )
    if (unmapped.length === 0) return phoneToPersonId
    if (!organizationSlug) {
      this.logger.warn(
        { outreachId, unmappedPhoneCount: unmapped.length },
        'Outreach has no organization scope; skipping People DB fallback',
      )
      return phoneToPersonId
    }

    const organization = await this.client.organization.findUnique({
      where: { slug: organizationSlug },
    })
    if (!organization) {
      this.logger.warn(
        { outreachId, organizationSlug },
        'Organization not found; skipping People DB fallback',
      )
      return phoneToPersonId
    }

    this.logger.info(
      { outreachId, unmappedPhoneCount: unmapped.length },
      "Some reply phones weren't on this send; trying People DB fallback",
    )
    for (const { digits, personId } of await this.lookupPeople(
      outreachId,
      organization,
      unmapped,
    )) {
      if (personId) phoneToPersonId.set(digits, personId)
    }
    return phoneToPersonId
  }

  private async lookupPeople(
    outreachId: number,
    organization: Organization,
    unmapped: string[],
  ): Promise<{ digits: string; personId: string | null }[]> {
    // Pro-access depends only on the organization, so resolve it once
    // instead of letting every findPersonByPhone re-query the campaign.
    let proAccess: boolean
    try {
      proAccess = await this.contactsService.resolveProAccess(organization)
    } catch (err) {
      this.logger.warn(
        { err: serializeError(err), outreachId },
        'Could not resolve pro access; skipping People DB fallback',
      )
      return []
    }

    return pmap(
      unmapped,
      async (digits) => {
        try {
          const person = await this.contactsService.findPersonByPhone(
            digits,
            organization,
            proAccess,
          )
          return { digits, personId: person?.id ?? null }
        } catch (err) {
          this.logger.warn(
            { err: serializeError(err), outreachId, phone: digits },
            'People DB lookup failed for an unmapped reply phone',
          )
          return { digits, personId: null }
        }
      },
      { concurrency: PEOPLE_LOOKUP_CONCURRENCY },
    )
  }

  /**
   * Step 5. This is what lights up the results counts, the opt-out chip on
   * the person record, and the scrub for the next send.
   *
   * The message row id is the sourceEventId, so re-ingesting the same reply
   * re-applies the same event — which applyInboundEvent makes a no-op in the
   * UPDATE's WHERE clause. A reply and an opt-out from the same message
   * share that id: the row has a single stamp slot, the reply claims it, and
   * the opt-out's own idempotency rides on optedOutAt being null.
   */
  private async applyInboundEvents(
    outreachId: number,
    messages: Prisma.PollIndividualMessageCreateManyInput[],
  ): Promise<void> {
    for (const message of messages) {
      const observedAt =
        message.sentAt instanceof Date
          ? message.sentAt
          : new Date(message.sentAt)
      const outcome = await this.textInteractions.applyInboundEvent({
        outreachId,
        personIds: [message.personId],
        eventType: 'reply',
        sourceEventId: message.id,
        observedAt,
      })
      if (outcome === 'noRow') {
        // The outbound half materializes one row per recipient, so this
        // means the reply came from a phone that was never on the send and
        // was attributed through the People DB. Never create a row here —
        // that would break the one-row-per-recipient invariant.
        this.logger.warn(
          { outreachId, personId: message.personId },
          '[Outreach Ingest] reply matched a person with no interaction row',
        )
      }
      if (!message.isOptOut) continue
      await this.textInteractions.applyInboundEvent({
        outreachId,
        personIds: [message.personId],
        eventType: 'optout',
        sourceEventId: message.id,
        observedAt,
      })
    }
  }
}
