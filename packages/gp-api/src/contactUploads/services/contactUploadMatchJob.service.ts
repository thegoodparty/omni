import { Injectable } from '@nestjs/common'
import { CONTACT_UPLOAD_FIELDS } from '@goodparty_org/contracts'
import { v7 as uuidv7 } from 'uuid'
import {
  ContactUpload,
  ContactUploadMatch,
  ContactUploadMatchMethod,
  ContactUploadMatchOutcome,
  ContactUploadStatus,
  Organization,
  Prisma,
} from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ContactsService } from '@/contacts/services/contacts.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import type { PeopleDataset } from '@/peopleDb/services/peopleDataset.service'
import type {
  ContactUploadMatchCandidateRow,
  ContactUploadMatchInputRow,
} from '@/peopleDb/databricks/contactUploadMatchSql.util'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import {
  addressParts,
  decideFromCandidates,
  nameKey,
  type MatchDecision,
} from '../util/contactUploadMatching.util'
import { ContactUploadsService } from './contactUploads.service'

const MATCH_CHUNK_SIZE = 20_000

// The main queue's redrive maxReceiveCount (deploy/index.ts). The delivery
// that reaches it is the last one, so it marks the upload failed instead of
// handing the message to the DLQ with the upload still `processing`.
export const CONTACT_UPLOAD_MATCH_MAX_RECEIVES = 3

const FAILURE_REASON = 'Matching did not finish'

type KeyedRow = {
  row: ContactUploadMatch
  firstKey: string
  lastKey: string
  house: string | null
  streetKey: string | null
}

type PriorRow = {
  personId: string
  isNewPerson: boolean
  firstName: string | null
  lastName: string | null
  email: string | null
  cellPhone: string | null
  landline: string | null
  addressLine: string | null
  zip: string | null
}

type OverlayRow = Pick<
  ContactUploadMatch,
  | 'personId'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'cellPhone'
  | 'landline'
  | 'addressLine'
  | 'city'
  | 'zip'
>

const phoneKeys = (keyed: KeyedRow): string[] =>
  keyed.lastKey === ''
    ? []
    : [keyed.row.cellPhone, keyed.row.landline]
        .filter((phone): phone is string => phone !== null)
        .map((phone) => `${phone}|${keyed.lastKey}`)

const nameAddressKey = (
  firstKey: string,
  lastKey: string,
  house: string | null,
  streetKey: string | null,
): string | null =>
  firstKey && lastKey && house && streetKey
    ? `${firstKey}|${lastKey}|${house}|${streetKey}`
    : null

@Injectable()
export class ContactUploadMatchJobService extends createPrismaBase(
  MODELS.ContactUploadMatch,
) {
  constructor(
    private readonly uploads: ContactUploadsService,
    private readonly contacts: ContactsService,
    private readonly voterQuery: VoterQueryService,
    private readonly analytics: AnalyticsService,
  ) {
    super()
  }

  // Queue handler for QueueType.CONTACT_UPLOAD_MATCH. Returns true to ack,
  // false to let SQS redeliver. Only `pending` rows are worked and each chunk
  // commits on its own, so a redelivery resumes where the last one stopped.
  async handleQueuedMatch(
    uploadId: string,
    receiveCount: number,
  ): Promise<boolean> {
    const upload = await this.client.contactUpload.findFirst({
      where: { id: uploadId, status: ContactUploadStatus.processing },
      include: { organization: true },
    })
    if (!upload) {
      this.logger.info(
        { uploadId },
        'contactUploadMatch: upload is not processing; acking',
      )
      return true
    }

    let failed = false
    try {
      await this.matchUpload(upload, upload.organization)
    } catch (err) {
      const lastAttempt = receiveCount >= CONTACT_UPLOAD_MATCH_MAX_RECEIVES
      this.logger.error(
        { err, uploadId, receiveCount, lastAttempt },
        'contactUploadMatch: matching failed',
      )
      if (!lastAttempt) return false
      failed = true
    }
    if (failed) {
      await this.client.contactUpload.updateMany({
        where: { id: uploadId, status: ContactUploadStatus.processing },
        data: {
          status: ContactUploadStatus.failed,
          failureReason: FAILURE_REASON,
        },
      })
    }
    return true
  }

  private async matchUpload(
    upload: ContactUpload,
    organization: Organization,
  ): Promise<void> {
    const { districtId, dataset } =
      await this.contacts.resolveEligibleDistrict(organization)

    let afterRowIndex = -1
    let chunks = 0
    for (;;) {
      const rows = await this.model.findMany({
        where: {
          uploadId: upload.id,
          outcome: ContactUploadMatchOutcome.pending,
          rowIndex: { gt: afterRowIndex },
        },
        orderBy: { rowIndex: Prisma.SortOrder.asc },
        take: MATCH_CHUNK_SIZE,
      })
      const lastRow = rows[rows.length - 1]
      if (!lastRow) break
      await this.matchChunk(upload, rows, districtId, dataset)
      afterRowIndex = lastRow.rowIndex
      chunks += 1
    }

    const finished = await this.client.$transaction(async (tx) => {
      const counts = await this.uploads.countOutcomes(tx, upload.id)
      const needsInput = counts.needsInputCount > 0
      return tx.contactUpload.update({
        where: { id: upload.id },
        data: {
          ...counts,
          status: needsInput
            ? ContactUploadStatus.needs_input
            : ContactUploadStatus.complete,
          completedAt: needsInput ? null : new Date(),
          failureReason: null,
        },
      })
    })

    this.logger.info(
      {
        uploadId: upload.id,
        rowCount: finished.rowCount,
        chunks,
        matchedCount: finished.matchedCount,
        newCount: finished.newCount,
        needsInputCount: finished.needsInputCount,
        invalidCount: finished.invalidCount,
        updatedCount: finished.updatedCount,
        unchangedCount: finished.unchangedCount,
      },
      'contactUploadMatch: done',
    )

    if (finished.userId !== null) {
      const [gained] = await this.client.$queryRaw<{ count: number }[]>`
        SELECT count(DISTINCT m.person_id)::int AS count
        FROM contact_upload_match m
        WHERE m.upload_id = ${upload.id}
          AND m.email IS NOT NULL
          AND m.person_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM contact_upload_match p
            WHERE p.organization_slug = m.organization_slug
              AND p.person_id = m.person_id
              AND p.upload_id <> m.upload_id
              AND p.email = m.email
          )
      `
      const earlierUploads = await this.client.contactUpload.count({
        where: {
          organizationSlug: upload.organizationSlug,
          createdAt: { lt: upload.createdAt },
        },
      })
      void this.analytics
        .track(finished.userId, EVENTS.Contacts.ImportCompleted, {
          uploadId: upload.id,
          rowCount: finished.rowCount,
          matchedCount: finished.matchedCount,
          newCount: finished.newCount,
          ambiguousCount: finished.needsInputCount,
          emailsGained: gained?.count ?? 0,
          isReimport: earlierUploads > 0,
        })
        .catch(() => undefined)
    }
  }

  private async matchChunk(
    upload: ContactUpload,
    rows: ContactUploadMatch[],
    districtId: string,
    dataset: PeopleDataset,
  ): Promise<void> {
    const keyed: KeyedRow[] = rows.map((row) => ({
      row,
      firstKey: nameKey(row.firstName),
      lastKey: nameKey(row.lastName),
      ...addressParts(row.addressLine),
    }))

    // Within the file: a later row with an earlier row's email, or phone and
    // last name, follows that row to whatever person it lands on.
    const leaderOf = new Map<string, KeyedRow>()
    const leaders: KeyedRow[] = []
    const leaderByEmail = new Map<string, KeyedRow>()
    const leaderByPhone = new Map<string, KeyedRow>()
    for (const entry of keyed) {
      const keys = phoneKeys(entry)
      const leader =
        (entry.row.email ? leaderByEmail.get(entry.row.email) : undefined) ??
        keys
          .map((key) => leaderByPhone.get(key))
          .find((found) => found !== undefined)
      if (leader) {
        leaderOf.set(entry.row.id, leader)
      } else {
        leaders.push(entry)
      }
      const owner = leader ?? entry
      if (entry.row.email && !leaderByEmail.has(entry.row.email)) {
        leaderByEmail.set(entry.row.email, owner)
      }
      for (const key of keys) {
        if (!leaderByPhone.has(key)) leaderByPhone.set(key, owner)
      }
    }

    const decisions = new Map<string, MatchDecision>()

    // The org's earlier rows, this upload's earlier chunks included: by
    // email, then phone and last name, then name and address.
    const emails = [
      ...new Set(
        leaders
          .map((entry) => entry.row.email)
          .filter((email): email is string => email !== null),
      ),
    ]
    const phones = [
      ...new Set(
        leaders.flatMap((entry) =>
          [entry.row.cellPhone, entry.row.landline].filter(
            (phone): phone is string => phone !== null,
          ),
        ),
      ),
    ]
    const lastKeys = [
      ...new Set(leaders.map((entry) => entry.lastKey).filter(Boolean)),
    ]
    const prior = await this.client.$queryRaw<PriorRow[]>`
      SELECT person_id AS "personId", is_new_person AS "isNewPerson",
        first_name AS "firstName", last_name AS "lastName", email,
        cell_phone AS "cellPhone", landline, address_line AS "addressLine",
        zip
      FROM contact_upload_match
      WHERE organization_slug = ${upload.organizationSlug}
        AND person_id IS NOT NULL
        AND (
          email = ANY(${emails}::text[])
          OR cell_phone = ANY(${phones}::text[])
          OR landline = ANY(${phones}::text[])
          OR regexp_replace(lower(last_name), '[^a-z]', '', 'g')
            = ANY(${lastKeys}::text[])
        )
      ORDER BY id DESC
    `
    const priorByEmail = new Map<string, PriorRow>()
    const priorByPhone = new Map<string, PriorRow>()
    const priorByNameAddress = new Map<string, PriorRow[]>()
    for (const row of prior) {
      const lastKey = nameKey(row.lastName)
      if (row.email && !priorByEmail.has(row.email)) {
        priorByEmail.set(row.email, row)
      }
      if (lastKey) {
        for (const phone of [row.cellPhone, row.landline]) {
          const key = `${phone}|${lastKey}`
          if (phone && !priorByPhone.has(key)) priorByPhone.set(key, row)
        }
      }
      const { house, streetKey } = addressParts(row.addressLine)
      const key = nameAddressKey(
        nameKey(row.firstName),
        lastKey,
        house,
        streetKey,
      )
      if (key) {
        priorByNameAddress.set(key, [
          ...(priorByNameAddress.get(key) ?? []),
          row,
        ])
      }
    }

    const toDistrict: KeyedRow[] = []
    for (const entry of leaders) {
      const addressKey = nameAddressKey(
        entry.firstKey,
        entry.lastKey,
        entry.house,
        entry.streetKey,
      )
      const hit =
        (entry.row.email ? priorByEmail.get(entry.row.email) : undefined) ??
        phoneKeys(entry)
          .map((key) => priorByPhone.get(key))
          .find((found) => found !== undefined) ??
        (addressKey
          ? priorByNameAddress
              .get(addressKey)
              ?.find(
                (row) =>
                  row.zip === null ||
                  entry.row.zip === null ||
                  row.zip === entry.row.zip,
              )
          : undefined)
      if (hit) {
        decisions.set(entry.row.id, {
          outcome: 'matched',
          method: ContactUploadMatchMethod.prior_upload,
          personId: hit.personId,
          isNewPerson: hit.isNewPerson,
          candidatePersonIds: [],
          suggestedPersonId: null,
        })
      } else if (entry.firstKey && entry.lastKey) {
        toDistrict.push(entry)
      }
    }

    const inputs: ContactUploadMatchInputRow[] = toDistrict.map((entry) => ({
      rowIndex: entry.row.rowIndex,
      firstKey: entry.firstKey,
      lastKey: entry.lastKey,
      cell: entry.row.cellPhone,
      landline: entry.row.landline,
      house: entry.house,
      streetKey: entry.streetKey,
      zip: entry.row.zip,
    }))
    const candidates =
      inputs.length === 0
        ? []
        : await this.voterQuery.matchContactUploadRows(
            districtId,
            dataset,
            inputs,
          )
    const candidatesByRow = new Map<number, ContactUploadMatchCandidateRow[]>()
    for (const candidate of candidates) {
      candidatesByRow.set(candidate.rowIndex, [
        ...(candidatesByRow.get(candidate.rowIndex) ?? []),
        candidate,
      ])
    }
    for (const entry of toDistrict) {
      const found = (candidatesByRow.get(entry.row.rowIndex) ?? []).sort(
        (a, b) =>
          Number(b.phoneAgrees) - Number(a.phoneAgrees) ||
          Number(b.addressAgrees) - Number(a.addressAgrees) ||
          a.personId.localeCompare(b.personId),
      )
      const decision = decideFromCandidates(found)
      if (decision) decisions.set(entry.row.id, decision)
    }

    for (const entry of leaders) {
      if (!decisions.has(entry.row.id)) {
        decisions.set(entry.row.id, {
          outcome: 'new',
          method: null,
          personId: uuidv7(),
          isNewPerson: true,
          candidatePersonIds: [],
          suggestedPersonId: null,
        })
      }
    }
    for (const [rowId, leader] of leaderOf) {
      const decision = decisions.get(leader.row.id)
      if (decision) decisions.set(rowId, decision)
    }

    // Re-import: what an earlier upload already gave the person each row
    // landed on, latest upload first, so a row's changedFields say what it
    // changed.
    const personIds = [
      ...new Set(
        [...decisions.values()]
          .map((decision) => decision.personId)
          .filter((id): id is string => id !== null),
      ),
    ]
    const overlayRows =
      personIds.length === 0
        ? []
        : await this.client.$queryRaw<OverlayRow[]>`
            SELECT m.person_id AS "personId", m.first_name AS "firstName",
              m.last_name AS "lastName", m.email, m.cell_phone AS "cellPhone",
              m.landline, m.address_line AS "addressLine", m.city, m.zip
            FROM contact_upload_match m
            JOIN contact_upload u ON u.id = m.upload_id
            WHERE m.organization_slug = ${upload.organizationSlug}
              AND m.person_id = ANY(${personIds}::text[])
              AND m.upload_id <> ${upload.id}
            ORDER BY u.created_at DESC, m.row_index DESC
          `
    const overlay = new Map<string, OverlayRow>()
    for (const row of overlayRows) {
      if (row.personId === null) continue
      const current = overlay.get(row.personId)
      if (!current) {
        overlay.set(row.personId, row)
        continue
      }
      for (const field of CONTACT_UPLOAD_FIELDS) {
        if (current[field] === null) current[field] = row[field]
      }
    }

    let updatedCount = 0
    let unchangedCount = 0
    const changedFieldsByRow = new Map<string, string[]>()
    for (const { row } of keyed) {
      const personId = decisions.get(row.id)?.personId
      const current = personId ? overlay.get(personId) : undefined
      if (!current) continue
      const changed = CONTACT_UPLOAD_FIELDS.filter(
        (field) => row[field] !== null && row[field] !== current[field],
      )
      changedFieldsByRow.set(row.id, changed)
      if (changed.length > 0) updatedCount += 1
      else unchangedCount += 1
    }

    const written = keyed.flatMap(({ row }) => {
      const decision = decisions.get(row.id)
      return decision ? [{ row, decision }] : []
    })
    await this.client.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE contact_upload_match AS m
        SET outcome = v.outcome::"ContactUploadMatchOutcome",
            method = v.method::"ContactUploadMatchMethod",
            person_id = v.person_id,
            is_new_person = v.is_new_person,
            candidate_person_ids = string_to_array(v.candidates, ','),
            suggested_person_id = v.suggested,
            changed_fields = string_to_array(v.changed, ','),
            updated_at = now()
        FROM unnest(
          ${written.map(({ row }) => row.id)}::text[],
          ${written.map(({ decision }) => decision.outcome)}::text[],
          ${written.map(({ decision }) => decision.method)}::text[],
          ${written.map(({ decision }) => decision.personId)}::text[],
          ${written.map(({ decision }) => decision.isNewPerson)}::boolean[],
          ${written.map(({ decision }) => decision.candidatePersonIds.join(','))}::text[],
          ${written.map(({ decision }) => decision.suggestedPersonId)}::text[],
          ${written.map(({ row }) => (changedFieldsByRow.get(row.id) ?? []).join(','))}::text[]
        ) AS v(id, outcome, method, person_id, is_new_person, candidates,
          suggested, changed)
        WHERE m.id = v.id AND m.outcome = 'pending'
      `
      await tx.contactUpload.update({
        where: { id: upload.id },
        data: {
          updatedCount: { increment: updatedCount },
          unchangedCount: { increment: unchangedCount },
        },
      })
    })
  }
}
