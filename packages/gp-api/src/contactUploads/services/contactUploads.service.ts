import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  CONTACT_UPLOAD_MAX_BYTES,
  CONTACT_UPLOAD_UNDOABLE_STATUSES,
  type AcceptSuggestedMatchesResponse,
  type ContactUpload as ContactUploadResponse,
  type ContactUploadCandidate,
  type ContactUploadColumnMapping,
  type ContactUploadRow,
  type ContactUploadUndoPreview,
  type ListContactUploadRowsResponse,
  type ListContactUploadsResponse,
  type PresignContactUploadFileResponse,
  type SetContactUploadRowMatch,
} from '@goodparty_org/contracts'
import { MimeTypes } from 'http-constants-ts'
import { v7 as uuidv7 } from 'uuid'
import {
  ContactUpload,
  ContactUploadMatch,
  ContactUploadMatchMethod,
  ContactUploadMatchOutcome,
  ContactUploadResolution,
  ContactUploadStatus,
  Organization,
  Prisma,
} from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { JobsService } from '@/jobs/jobs.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { ListPeopleDTO } from '@/peopleDb/schemas/people.schema'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import {
  type ContactUploadCounts,
  type ContactUploadOutcomeGroup,
  countsFromOutcomeGroups,
} from '../util/contactUploadCounts.util'
import { ContactUploadFilesService } from './contactUploadFiles.service'
import { ContactUploadMatchService } from './contactUploadMatch.service'

const FILE_UPLOAD_EXPIRES_SECONDS = 15 * 60

export const uploadsBucket = (): string => {
  const bucket = process.env.CONTACT_UPLOADS_BUCKET
  if (!bucket) {
    throw new ServiceUnavailableException(
      'CONTACT_UPLOADS_BUCKET is not configured',
    )
  }
  return bucket
}

const fileKeyOf = (organization: Organization, uploadId: string): string =>
  `${organization.slug}/${uploadId}.csv`

const UPLOAD_USER_INCLUDE = {
  user: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ContactUploadInclude

type ContactUploadWithUser = Prisma.ContactUploadGetPayload<{
  include: typeof UPLOAD_USER_INCLUDE
}>

export type ListContactUploadRowsInput = {
  outcome: 'needs_input' | 'processed' | 'skipped' | 'invalid'
  search?: string
  rowId?: string
  inVoterFile?: boolean
  cursor?: number
  take: number
}

const OUTCOMES_BY_FILTER: Record<
  ListContactUploadRowsInput['outcome'],
  ContactUploadMatchOutcome[]
> = {
  needs_input: [ContactUploadMatchOutcome.needs_input],
  processed: [
    ContactUploadMatchOutcome.matched,
    ContactUploadMatchOutcome.new,
    ContactUploadMatchOutcome.resolved,
  ],
  skipped: [ContactUploadMatchOutcome.skipped],
  invalid: [ContactUploadMatchOutcome.invalid],
}

export const columnMappingOf = (
  upload: ContactUpload,
): ContactUploadColumnMapping => ({
  firstName: upload.firstNameColumn,
  lastName: upload.lastNameColumn,
  email: upload.emailColumn,
  cellPhone: upload.cellPhoneColumn,
  landline: upload.landlineColumn,
  addressLine: upload.addressLineColumn,
  city: upload.cityColumn,
  zip: upload.zipColumn,
})

type UploadProgress = NonNullable<ContactUploadResponse['progress']>

const toUploadResponse = (
  upload: ContactUploadWithUser,
  progress: UploadProgress | null = null,
): ContactUploadResponse => ({
  id: upload.id,
  createdAt: upload.createdAt.toISOString(),
  name: upload.name,
  fileName: upload.fileName,
  uploadedBy: upload.user
    ? {
        id: upload.user.id,
        name:
          [upload.user.firstName, upload.user.lastName]
            .filter(Boolean)
            .join(' ') || null,
      }
    : null,
  status: upload.status,
  columnMapping: columnMappingOf(upload),
  rowCount: upload.rowCount,
  matchedCount: upload.matchedCount,
  newCount: upload.newCount,
  needsInputCount: upload.needsInputCount,
  skippedCount: upload.skippedCount,
  invalidCount: upload.invalidCount,
  updatedCount: upload.updatedCount,
  unchangedCount: upload.unchangedCount,
  completedAt: upload.completedAt?.toISOString() ?? null,
  failureReason: upload.failureReason,
  failureKind: upload.failureKind,
  progress:
    upload.status === ContactUploadStatus.processing
      ? (progress ?? { added: 0, needsInput: 0 })
      : null,
})

const toRowResponse = (
  row: ContactUploadMatch,
  candidates: ContactUploadCandidate[],
): ContactUploadRow => ({
  id: row.id,
  rowIndex: row.rowIndex,
  firstName: row.firstName,
  lastName: row.lastName,
  email: row.email,
  cellPhone: row.cellPhone,
  landline: row.landline,
  addressLine: row.addressLine,
  city: row.city,
  zip: row.zip,
  outcome: row.outcome,
  personId: row.personId,
  isNewPerson: row.isNewPerson,
  changedFields: row.changedFields,
  candidates,
  suggestedPersonId: row.suggestedPersonId,
})

const personKind = (row: {
  personId: string | null
  isNewPerson: boolean
}): 'l2' | 'new' | 'none' =>
  row.personId === null ? 'none' : row.isNewPerson ? 'new' : 'l2'

@Injectable()
export class ContactUploadsService extends createPrismaBase(
  MODELS.ContactUpload,
) {
  constructor(
    private readonly s3: S3Service,
    private readonly jobs: JobsService,
    private readonly contacts: ContactsService,
    private readonly voterQuery: VoterQueryService,
    private readonly analytics: AnalyticsService,
    private readonly matches: ContactUploadMatchService,
    private readonly contactUploadFiles: ContactUploadFilesService,
  ) {
    super()
  }

  async presignFile(args: {
    organization: Organization
    userId: number
    byteSize: number
    fileName: string
    name: string
    columnMapping: ContactUploadColumnMapping
  }): Promise<PresignContactUploadFileResponse> {
    const { organization, columnMapping } = args
    const bucket = uploadsBucket()
    const id = uuidv7()
    const fileKey = fileKeyOf(organization, id)
    const uploadUrl = await this.s3.getSignedUrlForSizedUpload(
      bucket,
      fileKey,
      {
        expiresIn: FILE_UPLOAD_EXPIRES_SECONDS,
        contentType: MimeTypes.IMAGE_CSV,
        contentLength: args.byteSize,
      },
    )
    await this.model.create({
      data: {
        id,
        organizationSlug: organization.slug,
        userId: args.userId,
        name: args.name,
        fileName: args.fileName,
        fileKey,
        firstNameColumn: columnMapping.firstName,
        lastNameColumn: columnMapping.lastName,
        emailColumn: columnMapping.email,
        cellPhoneColumn: columnMapping.cellPhone,
        landlineColumn: columnMapping.landline,
        addressLineColumn: columnMapping.addressLine,
        cityColumn: columnMapping.city,
        zipColumn: columnMapping.zip,
        consentAffirmedAt: new Date(),
        status: ContactUploadStatus.awaiting_file,
      },
    })
    return {
      uploadId: id,
      uploadUrl,
      expiresAt: new Date(
        Date.now() + FILE_UPLOAD_EXPIRES_SECONDS * 1000,
      ).toISOString(),
    }
  }

  // The browser's PUT landed: check the object is there and queue the job
  // that reads it. Only the call that moves the upload out of awaiting_file
  // queues it; a repeat or overlapping call returns the upload unchanged.
  async confirmUploaded(
    organization: Organization,
    id: string,
  ): Promise<ContactUploadResponse> {
    const bucket = uploadsBucket()
    const upload = await this.model.findFirst({
      where: { id, organizationSlug: organization.slug },
      include: UPLOAD_USER_INCLUDE,
    })
    if (!upload) throw new NotFoundException('Upload not found')
    if (upload.status !== ContactUploadStatus.awaiting_file) {
      return this.getUpload(organization, id)
    }
    const head = await this.s3.headObject(bucket, upload.fileKey)
    if (!head) throw new BadRequestException('upload_not_received')
    if ((head.contentLength ?? 0) > CONTACT_UPLOAD_MAX_BYTES) {
      throw new BadRequestException('upload_too_large')
    }
    // The status change and the job commit together, so an upload is never
    // `processing` without a job to process it.
    try {
      await this.client.$transaction(async (tx) => {
        const { count } = await tx.contactUpload.updateMany({
          where: { id, status: ContactUploadStatus.awaiting_file },
          data: { status: ContactUploadStatus.processing },
        })
        if (count === 0) return
        const processJobId = await this.jobs.send(
          'contactUploadProcess',
          { uploadId: id },
          { tx, group: organization.slug },
        )
        await tx.contactUpload.update({
          where: { id },
          data: { processJobId },
        })
      })
    } catch (err) {
      this.logger.error({ err, uploadId: id }, 'contact upload enqueue failed')
      throw new BadGatewayException('Could not start this upload')
    }
    return this.getUpload(organization, id)
  }

  async listUploads(
    organization: Organization,
  ): Promise<ListContactUploadsResponse> {
    const uploads = await this.model.findMany({
      where: {
        organizationSlug: organization.slug,
        status: { not: ContactUploadStatus.awaiting_file },
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      include: UPLOAD_USER_INCLUDE,
    })
    const progress = await this.progressOf(
      uploads
        .filter((upload) => upload.status === ContactUploadStatus.processing)
        .map((upload) => upload.id),
    )
    return {
      uploads: uploads.map((upload) =>
        toUploadResponse(upload, progress.get(upload.id)),
      ),
    }
  }

  async getUpload(
    organization: Organization,
    id: string,
  ): Promise<ContactUploadResponse> {
    const upload = await this.findOwnedUpload(organization, id)
    const progress =
      upload.status === ContactUploadStatus.processing
        ? await this.progressOf([upload.id])
        : new Map<string, UploadProgress>()
    return toUploadResponse(upload, progress.get(upload.id))
  }

  // The job writes the counts only when it finishes, so a processing upload's
  // progress is read from its rows: one grouped count on the
  // (uploadId, outcome) index for every upload asked for.
  private async progressOf(
    uploadIds: string[],
  ): Promise<Map<string, UploadProgress>> {
    const progress = new Map<string, UploadProgress>()
    if (uploadIds.length === 0) return progress
    const groups = await this.client.contactUploadMatch.groupBy({
      by: ['uploadId', 'outcome'],
      where: {
        uploadId: { in: uploadIds },
        outcome: {
          in: [
            ...OUTCOMES_BY_FILTER.processed,
            ...OUTCOMES_BY_FILTER.needs_input,
          ],
        },
      },
      _count: { _all: true },
    })
    for (const group of groups) {
      const current = progress.get(group.uploadId) ?? {
        added: 0,
        needsInput: 0,
      }
      if (group.outcome === ContactUploadMatchOutcome.needs_input) {
        current.needsInput += group._count._all
      } else {
        current.added += group._count._all
      }
      progress.set(group.uploadId, current)
    }
    return progress
  }

  async listRows(
    organization: Organization,
    id: string,
    query: ListContactUploadRowsInput,
  ): Promise<ListContactUploadRowsResponse> {
    await this.findOwnedUpload(organization, id)
    const tokens = (query.search ?? '').split(/\s+/).filter(Boolean)
    const where: Prisma.ContactUploadMatchWhereInput = {
      uploadId: id,
      ...(query.rowId === undefined ? {} : { id: query.rowId }),
      outcome: { in: OUTCOMES_BY_FILTER[query.outcome] },
      ...(query.outcome === 'processed' && query.inVoterFile !== undefined
        ? { isNewPerson: !query.inVoterFile }
        : {}),
      AND: tokens.map((token) => ({
        OR: [
          {
            firstName: {
              contains: token,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          {
            lastName: { contains: token, mode: Prisma.QueryMode.insensitive },
          },
          { email: { contains: token, mode: Prisma.QueryMode.insensitive } },
        ],
      })),
    }
    const [rows, total] = await Promise.all([
      this.client.contactUploadMatch.findMany({
        where: {
          ...where,
          ...(query.cursor === undefined
            ? {}
            : { rowIndex: { gt: query.cursor } }),
        },
        orderBy: { rowIndex: Prisma.SortOrder.asc },
        take: query.take + 1,
      }),
      this.client.contactUploadMatch.count({ where }),
    ])
    const page = rows.slice(0, query.take)
    const lastRow = page[page.length - 1]
    const candidatesById = await this.candidatesFor(
      organization,
      page.filter(
        (row) => row.outcome === ContactUploadMatchOutcome.needs_input,
      ),
    )
    return {
      rows: page.map((row) =>
        toRowResponse(
          row,
          row.outcome === ContactUploadMatchOutcome.needs_input
            ? row.candidatePersonIds
                .map((personId) => candidatesById.get(personId))
                .filter(
                  (candidate): candidate is ContactUploadCandidate =>
                    candidate !== undefined,
                )
            : [],
        ),
      ),
      nextCursor: rows.length > query.take && lastRow ? lastRow.rowIndex : null,
      total,
    }
  }

  async setRowMatch(args: {
    organization: Organization
    uploadId: string
    rowId: string
    userId: number
    body: SetContactUploadRowMatch
  }): Promise<ContactUploadResponse> {
    const { organization, uploadId, rowId, userId, body } = args
    const upload = await this.findOwnedUpload(organization, uploadId)
    const row = await this.client.contactUploadMatch.findFirst({
      where: { id: rowId, uploadId: upload.id },
    })
    if (!row) throw new NotFoundException('Upload row not found')
    if (row.outcome === ContactUploadMatchOutcome.pending) {
      throw new ConflictException('This row is still being matched')
    }
    if (row.outcome === ContactUploadMatchOutcome.invalid) {
      throw new BadRequestException('This row has no name to match')
    }

    const target =
      'skip' in body
        ? { personId: null, isNewPerson: false }
        : 'newPerson' in body
          ? { personId: uuidv7(), isNewPerson: true }
          : await this.resolvePickedPerson(
              organization,
              row,
              body.personId.toLowerCase(),
            )
    const resolution =
      'skip' in body
        ? ContactUploadResolution.skip
        : 'newPerson' in body
          ? ContactUploadResolution.new_person
          : row.candidatePersonIds.includes(body.personId.toLowerCase())
            ? ContactUploadResolution.candidate
            : ContactUploadResolution.search

    const updated = await this.client.$transaction(async (tx) => {
      await tx.contactUploadMatch.update({
        where: { id: row.id },
        data: {
          personId: target.personId,
          isNewPerson: target.isNewPerson,
          outcome:
            target.personId === null
              ? ContactUploadMatchOutcome.skipped
              : ContactUploadMatchOutcome.resolved,
          method: ContactUploadMatchMethod.manual,
          resolution,
          resolvedAt: new Date(),
          resolvedByUserId: userId,
        },
      })
      return this.recountAfterReview(tx, upload)
    })

    if (row.outcome === ContactUploadMatchOutcome.needs_input) {
      void this.analytics
        .track(userId, EVENTS.Contacts.AmbiguousRowResolved, {
          resolution,
          rowIndex: row.rowIndex,
          product: organization.slug.startsWith('eo-') ? 'serve' : 'win',
        })
        .catch(() => undefined)
    } else {
      void this.analytics
        .track(userId, EVENTS.Contacts.MatchChanged, {
          from: personKind(row),
          to: personKind(target),
          resolution,
          product: organization.slug.startsWith('eo-') ? 'serve' : 'win',
        })
        .catch(() => undefined)
    }
    return toUploadResponse(updated)
  }

  async acceptSuggested(args: {
    organization: Organization
    uploadId: string
    userId: number
  }): Promise<AcceptSuggestedMatchesResponse> {
    const upload = await this.findOwnedUpload(args.organization, args.uploadId)
    const { accepted, updated } = await this.client.$transaction(async (tx) => {
      const count = await tx.$executeRaw`
          UPDATE contact_upload_match
          SET person_id = suggested_person_id,
              is_new_person = false,
              outcome = 'resolved',
              method = 'manual',
              resolution = 'suggestion',
              resolved_at = now(),
              resolved_by_user_id = ${args.userId},
              updated_at = now()
          WHERE upload_id = ${upload.id}
            AND outcome = 'needs_input'
            AND suggested_person_id IS NOT NULL
        `
      return {
        accepted: count,
        updated: await this.recountAfterReview(tx, upload),
      }
    })
    if (accepted > 0) {
      void this.analytics
        .track(args.userId, EVENTS.Contacts.AmbiguousRowResolved, {
          resolution: ContactUploadResolution.suggestion,
          rowCount: accepted,
          product: args.organization.slug.startsWith('eo-') ? 'serve' : 'win',
        })
        .catch(() => undefined)
    }
    return { accepted, upload: toUploadResponse(updated) }
  }

  async retryUpload(
    organization: Organization,
    id: string,
  ): Promise<ContactUploadResponse> {
    await this.findOwnedUpload(organization, id)
    let retried: boolean
    try {
      retried = await this.client.$transaction(async (tx) => {
        const { count } = await tx.contactUpload.updateMany({
          where: { id, status: ContactUploadStatus.failed },
          data: {
            status: ContactUploadStatus.processing,
            failureReason: null,
            failureKind: null,
          },
        })
        if (count === 0) return false
        const processJobId = await this.jobs.send(
          'contactUploadProcess',
          { uploadId: id },
          { tx, group: organization.slug },
        )
        await tx.contactUpload.update({
          where: { id },
          data: { processJobId },
        })
        return true
      })
    } catch (err) {
      this.logger.error({ err, uploadId: id }, 'contact upload retry failed')
      throw new BadGatewayException('Could not start this upload')
    }
    if (!retried) {
      throw new ConflictException('Only a failed upload can be retried')
    }
    return this.getUpload(organization, id)
  }

  async undoPreview(
    organization: Organization,
    id: string,
  ): Promise<ContactUploadUndoPreview> {
    const upload = await this.findUndoableUpload(organization, id)
    const removed = await this.matches.newPeopleOnlyIn(
      organization.slug,
      upload.id,
    )
    return {
      removedPeopleCount: removed.length,
      hasActivity: await this.matches.hasActivity(organization.slug, removed),
    }
  }

  // Deleting the upload cascades to its rows, and the overlay view reads only
  // rows, so its values and the people only it added leave every people read.
  // Notes and activity stay on their person ids, as with Change match.
  async undoUpload(args: {
    organization: Organization
    uploadId: string
    userId: number
  }): Promise<void> {
    const { organization, userId } = args
    const upload = await this.findUndoableUpload(organization, args.uploadId)
    const removed = await this.matches.newPeopleOnlyIn(
      organization.slug,
      upload.id,
    )
    // The file goes first: a row deleted before its file would leave
    // nothing to retry the file from, and a repeat undo deletes no file.
    await this.contactUploadFiles.deleteFiles([upload])
    const { count } = await this.model.deleteMany({
      where: {
        id: upload.id,
        status: { in: [...CONTACT_UPLOAD_UNDOABLE_STATUSES] },
      },
    })
    if (count === 0) {
      throw new ConflictException('This upload is being matched again')
    }
    void this.analytics
      .track(userId, EVENTS.Contacts.ImportUndone, {
        uploadId: upload.id,
        status: upload.status,
        rowCount: upload.rowCount ?? 0,
        matchedCount: upload.matchedCount,
        newCount: upload.newCount,
        removedPeopleCount: removed.length,
        product: organization.slug.startsWith('eo-') ? 'serve' : 'win',
      })
      .catch(() => undefined)
  }

  async countOutcomes(
    tx: Prisma.TransactionClient,
    uploadId: string,
  ): Promise<ContactUploadCounts> {
    const groups = await tx.$queryRaw<ContactUploadOutcomeGroup[]>`
      SELECT outcome, is_new_person AS "isNewPerson", method,
        cardinality(changed_fields) > 0 AS "hasChangedFields",
        count(*)::int AS count
      FROM contact_upload_match
      WHERE upload_id = ${uploadId}
      GROUP BY 1, 2, 3, 4
    `
    return countsFromOutcomeGroups(groups)
  }

  private async recountAfterReview(
    tx: Prisma.TransactionClient,
    upload: ContactUpload,
  ): Promise<ContactUploadWithUser> {
    const counts = await this.countOutcomes(tx, upload.id)
    const finished =
      upload.status === ContactUploadStatus.needs_input &&
      counts.needsInputCount === 0
    return tx.contactUpload.update({
      where: { id: upload.id },
      data: {
        ...counts,
        ...(finished
          ? { status: ContactUploadStatus.complete, completedAt: new Date() }
          : {}),
      },
      include: UPLOAD_USER_INCLUDE,
    })
  }

  // A stored candidate, or (Change match) anyone this org can open on the
  // person panel. findPerson 404s an id the org cannot read.
  private async resolvePickedPerson(
    organization: Organization,
    row: ContactUploadMatch,
    personId: string,
  ): Promise<{ personId: string; isNewPerson: boolean }> {
    if (!row.candidatePersonIds.includes(personId)) {
      await this.contacts.findPerson(personId, organization)
    }
    const minted = await this.client.contactUploadMatch.findFirst({
      where: {
        organizationSlug: organization.slug,
        personId,
        isNewPerson: true,
      },
      select: { id: true },
    })
    return { personId, isNewPerson: minted !== null }
  }

  private async candidatesFor(
    organization: Organization,
    rows: ContactUploadMatch[],
  ): Promise<Map<string, ContactUploadCandidate>> {
    const ids = [...new Set(rows.flatMap((row) => row.candidatePersonIds))]
    if (ids.length === 0) return new Map()
    const { districtId, dataset } =
      await this.contacts.resolveEligibleDistrict(organization)
    const { people } = await this.voterQuery.findPeople(
      ListPeopleDTO.create({
        districtId,
        filters: { id: { in: ids } },
        resultsPerPage: ids.length,
        page: 1,
        skipCount: true,
      }),
      dataset,
    )
    return new Map(
      people.map((person) => [
        person.id,
        {
          personId: person.id,
          firstName: person.firstName,
          lastName: person.lastName,
          addressLine: person.address.line1,
          city: person.address.city,
          zip: person.address.zip,
          age: person.age,
        },
      ]),
    )
  }

  private async findUndoableUpload(
    organization: Organization,
    id: string,
  ): Promise<ContactUploadWithUser> {
    const upload = await this.findOwnedUpload(organization, id)
    if (
      !CONTACT_UPLOAD_UNDOABLE_STATUSES.some(
        (status) => status === upload.status,
      )
    ) {
      throw new ConflictException('This upload is still being matched')
    }
    return upload
  }

  private async findOwnedUpload(
    organization: Organization,
    id: string,
  ): Promise<ContactUploadWithUser> {
    const upload = await this.model.findFirst({
      where: {
        id,
        organizationSlug: organization.slug,
        status: { not: ContactUploadStatus.awaiting_file },
      },
      include: UPLOAD_USER_INCLUDE,
    })
    if (!upload) throw new NotFoundException('Upload not found')
    return upload
  }
}
