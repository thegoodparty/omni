import { Injectable } from '@nestjs/common'
import { CONTACT_UPLOAD_FIELDS } from '@goodparty_org/contracts'
import { v7 as uuidv7 } from 'uuid'
import {
  ContactUpload,
  ContactUploadFailureKind,
  ContactUploadFirstNameMatch,
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
import {
  fitContactUploadMatchRows,
  type ContactUploadMatchCandidateRow,
  type ContactUploadMatchInputRow,
} from '@/peopleDb/databricks/contactUploadMatchSql.util'
import { AnalyticsService } from '@/analytics/analytics.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import type { JobRun } from '@/jobs/jobs.registry'
import { EVENTS } from '@/vendors/segment/segment.types'
import {
  addressParts,
  decideFromCandidates,
  firstNameAliases,
  nameKey,
  type MatchDecision,
} from '../util/contactUploadMatching.util'
import {
  ContactUploadFileError,
  readContactUploadCsv,
} from '../util/contactUploadCsv.util'
import {
  ContactUploadsService,
  columnMappingOf,
  uploadsBucket,
} from './contactUploads.service'
import { STUCK_FAILURE_REASON } from './contactUploadStuck.service'

// fitContactUploadMatchRows cuts a chunk shorter when its rows' JSON is
// long: common first names carry 10 to 30 nicknames each, so a typical file
// lands near 3,400 rows a chunk.
export const MATCH_CHUNK_SIZE = 4_000

// One createMany per batch, no wrapping transaction: (uploadId, rowIndex) is
// unique, so a redelivery skips the rows an earlier delivery inserted.
const INSERT_CHUNK_SIZE = 5_000

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
  outcome: ContactUploadMatchOutcome
  method: ContactUploadMatchMethod | null
  firstName: string | null
  lastName: string | null
  email: string | null
  cellPhone: string | null
  landline: string | null
  addressLine: string | null
  city: string | null
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

const matchInput = (row: ContactUploadMatch): ContactUploadMatchInputRow => {
  const { house, streetKey } = addressParts(row.addressLine)
  const firstKey = nameKey(row.firstName)
  return {
    rowIndex: row.rowIndex,
    firstKey,
    firstAliases: firstNameAliases(firstKey),
    lastKey: nameKey(row.lastName),
    cell: row.cellPhone,
    landline: row.landline,
    house,
    streetKey,
    zip: row.zip,
  }
}

const isNameOnly = (
  row: Pick<
    ContactUploadMatch,
    'email' | 'cellPhone' | 'landline' | 'addressLine' | 'city' | 'zip'
  >,
): boolean =>
  row.email === null &&
  row.cellPhone === null &&
  row.landline === null &&
  row.addressLine === null &&
  row.city === null &&
  row.zip === null

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
export class ContactUploadProcessJobService extends createPrismaBase(
  MODELS.ContactUploadMatch,
) {
  constructor(
    private readonly uploads: ContactUploadsService,
    private readonly contacts: ContactsService,
    private readonly voterQuery: VoterQueryService,
    private readonly analytics: AnalyticsService,
    private readonly s3: S3Service,
  ) {
    super()
  }

  // Reads the file into rows if that has not happened yet, then matches
  // pending rows chunk by chunk until none remain. Rows insert with
  // skipDuplicates and only `pending` rows are matched, so a retry resumes
  // where the last attempt stopped. The last attempt marks the upload failed,
  // then throws so the job lands in the dead-letter queue. The
  // contactUploadProcess worker (src/jobs/jobs.registry.ts) calls this.
  async process(job: JobRun<{ uploadId: string }>): Promise<void> {
    const { uploadId } = job.data
    const upload = await this.client.contactUpload.findFirst({
      where: { id: uploadId, status: ContactUploadStatus.processing },
      include: { organization: true },
    })
    if (!upload) {
      this.logger.info(
        { uploadId },
        'contactUploadProcess: upload is not processing; done',
      )
      return
    }

    let failureReason: string | null = null
    let failureKind: ContactUploadFailureKind | null = null
    let deadLetter: Error | null = null
    try {
      if (upload.ingestedAt === null) await this.ingest(upload)
      while (await this.matchNextChunk(upload, upload.organization)) {
        // pg-boss aborts the signal when this task shuts down or the job
        // expires. Stopping between chunks lets the retry resume cleanly.
        if (job.signal.aborted) {
          throw new Error('contactUploadProcess: stopped between chunks')
        }
      }
    } catch (err) {
      if (err instanceof ContactUploadFileError) {
        this.logger.info(
          { uploadId },
          'contactUploadProcess: the file cannot be imported',
        )
        failureReason = err.message
        failureKind = ContactUploadFailureKind.file
      } else {
        const lastAttempt = job.retryCount >= job.retryLimit
        this.logger.error(
          { err, uploadId, retryCount: job.retryCount, lastAttempt },
          'contactUploadProcess: processing failed',
        )
        if (!lastAttempt) throw err
        failureReason = STUCK_FAILURE_REASON
        failureKind = ContactUploadFailureKind.transient
        deadLetter = err instanceof Error ? err : new Error(String(err))
      }
    }
    if (failureKind === ContactUploadFailureKind.file) {
      await this.model.deleteMany({ where: { uploadId } })
    }
    if (failureReason !== null) {
      const { count } = await this.client.contactUpload.updateMany({
        where: { id: uploadId, status: ContactUploadStatus.processing },
        data: {
          status: ContactUploadStatus.failed,
          failureReason,
          failureKind,
        },
      })
      const failed =
        count === 0
          ? null
          : await this.client.contactUpload.findUnique({
              where: { id: uploadId },
              select: { userId: true, rowCount: true },
            })
      if (failed && failed.userId !== null) {
        void this.analytics
          .track(failed.userId, EVENTS.Contacts.ImportFailed, {
            uploadId,
            failureKind,
            rowCount: failed.rowCount,
            product: upload.organizationSlug.startsWith('eo-')
              ? 'serve'
              : 'win',
          })
          .catch(() => undefined)
      }
    }
    if (deadLetter) throw deadLetter
  }

  private async ingest(upload: ContactUpload): Promise<void> {
    const file = await this.s3.getFileStream(uploadsBucket(), upload.fileKey)
    if (!file) {
      throw new ContactUploadFileError(
        "We couldn't find this file. Import it again.",
      )
    }
    let batch: Prisma.ContactUploadMatchCreateManyInput[] = []
    let rowCount = 0
    for await (const row of readContactUploadCsv(
      file,
      columnMappingOf(upload),
    )) {
      batch.push({
        uploadId: upload.id,
        organizationSlug: upload.organizationSlug,
        rowIndex: row.rowIndex,
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email,
        cellPhone: row.cellPhone,
        landline: row.landline,
        addressLine: row.addressLine,
        city: row.city,
        zip: row.zip,
        outcome: row.hasName
          ? ContactUploadMatchOutcome.pending
          : ContactUploadMatchOutcome.invalid,
      })
      rowCount++
      if (batch.length === INSERT_CHUNK_SIZE) {
        await this.model.createMany({ data: batch, skipDuplicates: true })
        batch = []
      }
    }
    if (batch.length > 0) {
      await this.model.createMany({ data: batch, skipDuplicates: true })
    }
    await this.client.contactUpload.update({
      where: { id: upload.id },
      data: { ingestedAt: new Date(), rowCount },
    })
    this.logger.info(
      { uploadId: upload.id, rowCount },
      'contactUploadProcess: file read into rows',
    )
  }

  // Matches one chunk. Resolves true while pending rows remain; on the last
  // chunk it records the upload's counts and resolves false.
  private async matchNextChunk(
    upload: ContactUpload,
    organization: Organization,
  ): Promise<boolean> {
    const pending = await this.model.findMany({
      where: {
        uploadId: upload.id,
        outcome: ContactUploadMatchOutcome.pending,
      },
      orderBy: { rowIndex: Prisma.SortOrder.asc },
      take: MATCH_CHUNK_SIZE,
    })
    const rows = pending.slice(
      0,
      fitContactUploadMatchRows(pending.map(matchInput)),
    )
    if (rows.length > 0) {
      const { districtId, dataset } =
        await this.contacts.resolveEligibleDistrict(organization)
      await this.matchChunk(upload, rows, districtId, dataset)
    }

    const nextPending = await this.model.findFirst({
      where: {
        uploadId: upload.id,
        outcome: ContactUploadMatchOutcome.pending,
      },
      orderBy: { rowIndex: Prisma.SortOrder.asc },
      select: { rowIndex: true },
    })
    if (nextPending) {
      this.logger.info(
        {
          uploadId: upload.id,
          chunkRows: rows.length,
          nextRowIndex: nextPending.rowIndex,
        },
        'contactUploadProcess: chunk done',
      )
      return true
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
          failureKind: null,
        },
      })
    })

    this.logger.info(
      {
        uploadId: upload.id,
        rowCount: finished.rowCount,
        chunkRows: rows.length,
        matchedCount: finished.matchedCount,
        newCount: finished.newCount,
        needsInputCount: finished.needsInputCount,
        skippedCount: finished.skippedCount,
        invalidCount: finished.invalidCount,
        updatedCount: finished.updatedCount,
        unchangedCount: finished.unchangedCount,
      },
      'contactUploadProcess: done',
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
      const firstNameMatches = await this.model.groupBy({
        by: ['firstNameMatch'],
        where: { uploadId: upload.id, firstNameMatch: { not: null } },
        _count: { _all: true },
      })
      const matchedBy = (firstNameMatch: ContactUploadFirstNameMatch) =>
        firstNameMatches.find(
          (group) => group.firstNameMatch === firstNameMatch,
        )?._count._all ?? 0
      const earlierUploads = await this.client.contactUpload.count({
        where: {
          organizationSlug: upload.organizationSlug,
          createdAt: { lt: upload.createdAt },
          status: { not: ContactUploadStatus.awaiting_file },
        },
      })
      void this.analytics
        .track(finished.userId, EVENTS.Contacts.ImportCompleted, {
          uploadId: upload.id,
          rowCount: finished.rowCount,
          matchedCount: finished.matchedCount,
          newCount: finished.newCount,
          ambiguousCount: finished.needsInputCount,
          matchedExactName: matchedBy(ContactUploadFirstNameMatch.exact),
          matchedNickname: matchedBy(ContactUploadFirstNameMatch.alias),
          matchedPrefix: matchedBy(ContactUploadFirstNameMatch.prefix),
          emailsGained: gained?.count ?? 0,
          isReimport: earlierUploads > 0,
          product: upload.organizationSlug.startsWith('eo-') ? 'serve' : 'win',
        })
        .catch(() => undefined)
    }
    return false
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
    // email, then phone and last name, then name and address, then a
    // name-only row the user resolved by hand to one person.
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
        outcome, method,
        first_name AS "firstName", last_name AS "lastName", email,
        cell_phone AS "cellPhone", landline, address_line AS "addressLine",
        city, zip
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
    const priorResolvedByName = new Map<string, PriorRow[]>()
    for (const row of prior) {
      const lastKey = nameKey(row.lastName)
      const firstKey = nameKey(row.firstName)
      if (
        row.outcome === ContactUploadMatchOutcome.resolved &&
        row.method === ContactUploadMatchMethod.manual &&
        firstKey &&
        lastKey &&
        isNameOnly(row)
      ) {
        const key = `${firstKey}|${lastKey}`
        priorResolvedByName.set(key, [
          ...(priorResolvedByName.get(key) ?? []),
          row,
        ])
      }
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
      const key = nameAddressKey(firstKey, lastKey, house, streetKey)
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
      const resolvedByName =
        entry.firstKey && entry.lastKey && isNameOnly(entry.row)
          ? priorResolvedByName.get(`${entry.firstKey}|${entry.lastKey}`)
          : undefined
      const [onlyResolved] = resolvedByName ?? []
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
          : undefined) ??
        (onlyResolved &&
        resolvedByName?.every((row) => row.personId === onlyResolved.personId)
          ? onlyResolved
          : undefined)
      if (hit) {
        decisions.set(entry.row.id, {
          outcome: 'matched',
          method: ContactUploadMatchMethod.prior_upload,
          firstNameMatch: null,
          personId: hit.personId,
          isNewPerson: hit.isNewPerson,
          candidatePersonIds: [],
          suggestedPersonId: null,
        })
      } else if (entry.firstKey && entry.lastKey) {
        toDistrict.push(entry)
      }
    }

    const inputs = toDistrict.map((entry) => matchInput(entry.row))
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
      const decision = decideFromCandidates(
        candidatesByRow.get(entry.row.rowIndex) ?? [],
      )
      if (decision) decisions.set(entry.row.id, decision)
    }

    for (const entry of leaders) {
      if (!decisions.has(entry.row.id)) {
        decisions.set(entry.row.id, {
          outcome: 'new',
          method: null,
          firstNameMatch: null,
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

    const changedFieldsByRow = new Map<string, string[]>()
    for (const { row } of keyed) {
      const personId = decisions.get(row.id)?.personId
      const current = personId ? overlay.get(personId) : undefined
      if (!current) continue
      const changed = CONTACT_UPLOAD_FIELDS.filter(
        (field) => row[field] !== null && row[field] !== current[field],
      )
      changedFieldsByRow.set(row.id, changed)
    }

    const written = keyed.flatMap(({ row }) => {
      const decision = decisions.get(row.id)
      return decision ? [{ row, decision }] : []
    })
    await this.client.$executeRaw`
        UPDATE contact_upload_match AS m
        SET outcome = v.outcome::"ContactUploadMatchOutcome",
            method = v.method::"ContactUploadMatchMethod",
            first_name_match =
              v.first_name_match::"ContactUploadFirstNameMatch",
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
          ${written.map(({ decision }) => decision.firstNameMatch)}::text[],
          ${written.map(({ decision }) => decision.personId)}::text[],
          ${written.map(({ decision }) => decision.isNewPerson)}::boolean[],
          ${written.map(({ decision }) => decision.candidatePersonIds.join(','))}::text[],
          ${written.map(({ decision }) => decision.suggestedPersonId)}::text[],
          ${written.map(({ row }) => (changedFieldsByRow.get(row.id) ?? []).join(','))}::text[]
        ) AS v(id, outcome, method, first_name_match, person_id,
          is_new_person, candidates, suggested, changed)
        WHERE m.id = v.id AND m.outcome = 'pending'
      `
  }
}
