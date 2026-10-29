import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  type AcceptSuggestedMatchesResponse,
  type ContactUpload as ContactUploadResponse,
  type ContactUploadCandidate,
  type ContactUploadColumnMapping,
  type ContactUploadRow,
  type ListContactUploadRowsResponse,
  type ListContactUploadsResponse,
  type SetContactUploadRowMatch,
} from '@goodparty_org/contracts'
import { MimeTypes } from 'http-constants-ts'
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
import { S3Service } from '@/vendors/aws/services/s3.service'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { MessageGroup, QueueType } from '@/queue/queue.types'
import { ContactsService } from '@/contacts/services/contacts.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { ListPeopleDTO } from '@/peopleDb/schemas/people.schema'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { parseContactUploadCsv } from '../util/contactUploadCsv.util'

const INSERT_CHUNK_SIZE = 5_000

const UPLOAD_USER_INCLUDE = {
  user: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ContactUploadInclude

type ContactUploadWithUser = Prisma.ContactUploadGetPayload<{
  include: typeof UPLOAD_USER_INCLUDE
}>

export type ContactUploadCounts = {
  matchedCount: number
  newCount: number
  needsInputCount: number
  skippedCount: number
  invalidCount: number
}

export type ListContactUploadRowsInput = {
  outcome: 'needs_input' | 'processed' | 'skipped' | 'invalid'
  search?: string
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

const columnMappingOf = (
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

const toUploadResponse = (
  upload: ContactUploadWithUser,
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
    private readonly queueProducer: QueueProducerService,
    private readonly contacts: ContactsService,
    private readonly voterQuery: VoterQueryService,
    private readonly analytics: AnalyticsService,
  ) {
    super()
  }

  async createUpload(args: {
    organization: Organization
    userId: number
    name: string
    columnMapping: ContactUploadColumnMapping
    fileName: string
    file: Buffer
  }): Promise<ContactUploadResponse> {
    const { organization, columnMapping } = args
    const rows = await parseContactUploadCsv(args.file, columnMapping)

    const id = uuidv7()
    const fileKey = `${organization.slug}/${id}.csv`
    const bucket = process.env.CONTACT_UPLOADS_BUCKET
    if (bucket) {
      await this.s3.uploadFile(bucket, args.file, fileKey, {
        contentType: MimeTypes.IMAGE_CSV,
      })
    } else {
      this.logger.warn(
        { uploadId: id },
        'CONTACT_UPLOADS_BUCKET is not configured; not storing the original file',
      )
    }

    const matchRows = rows.map((row) => ({
      uploadId: id,
      organizationSlug: organization.slug,
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
    }))
    const chunks: (typeof matchRows)[] = []
    for (let start = 0; start < matchRows.length; start += INSERT_CHUNK_SIZE) {
      chunks.push(matchRows.slice(start, start + INSERT_CHUNK_SIZE))
    }
    const [upload] = await this.client.$transaction([
      this.model.create({
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
          rowCount: rows.length,
          invalidCount: rows.filter((row) => !row.hasName).length,
        },
        include: UPLOAD_USER_INCLUDE,
      }),
      ...chunks.map((data) =>
        this.client.contactUploadMatch.createMany({ data }),
      ),
    ])

    let enqueueFailed = false
    try {
      await this.queueProducer.sendMessage(
        { type: QueueType.CONTACT_UPLOAD_MATCH, data: { uploadId: id } },
        `${MessageGroup.contactUploadMatch}-${organization.slug}`,
        {
          throwOnError: true,
          deduplicationId: `${QueueType.CONTACT_UPLOAD_MATCH}-${id}`,
        },
      )
    } catch (err) {
      this.logger.error({ err, uploadId: id }, 'contact upload enqueue failed')
      enqueueFailed = true
    }
    if (enqueueFailed) {
      await this.model.update({
        where: { id },
        data: {
          status: ContactUploadStatus.failed,
          failureReason: 'Matching could not be started',
        },
      })
      throw new BadGatewayException('Could not start matching this upload')
    }
    return toUploadResponse(upload)
  }

  async listUploads(
    organization: Organization,
  ): Promise<ListContactUploadsResponse> {
    const uploads = await this.model.findMany({
      where: { organizationSlug: organization.slug },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      include: UPLOAD_USER_INCLUDE,
    })
    return { uploads: uploads.map(toUploadResponse) }
  }

  async getUpload(
    organization: Organization,
    id: string,
  ): Promise<ContactUploadResponse> {
    return toUploadResponse(await this.findOwnedUpload(organization, id))
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
      outcome: { in: OUTCOMES_BY_FILTER[query.outcome] },
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
          resolvedAt: new Date(),
          resolvedByUserId: userId,
        },
      })
      return this.recountAfterReview(tx, upload)
    })

    if (row.outcome === ContactUploadMatchOutcome.needs_input) {
      void this.analytics
        .track(userId, EVENTS.Contacts.AmbiguousRowResolved, {
          resolution:
            'skip' in body ? 'skipped' : 'newPerson' in body ? 'new' : 'person',
          rowIndex: row.rowIndex,
        })
        .catch(() => undefined)
    } else {
      void this.analytics
        .track(userId, EVENTS.Contacts.MatchChanged, {
          from: personKind(row),
          to: personKind(target),
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
          resolution: 'acceptedSuggested',
          rowCount: accepted,
        })
        .catch(() => undefined)
    }
    return { accepted, upload: toUploadResponse(updated) }
  }

  async countOutcomes(
    tx: Prisma.TransactionClient,
    uploadId: string,
  ): Promise<ContactUploadCounts> {
    const groups = await tx.contactUploadMatch.groupBy({
      by: ['outcome', 'isNewPerson'],
      where: { uploadId },
      _count: { _all: true },
    })
    const count = (test: (group: (typeof groups)[number]) => boolean): number =>
      groups.filter(test).reduce((sum, group) => sum + group._count._all, 0)
    return {
      matchedCount: count(
        (g) =>
          g.outcome === ContactUploadMatchOutcome.matched ||
          (g.outcome === ContactUploadMatchOutcome.resolved && !g.isNewPerson),
      ),
      newCount: count(
        (g) =>
          g.outcome === ContactUploadMatchOutcome.new ||
          (g.outcome === ContactUploadMatchOutcome.resolved && g.isNewPerson),
      ),
      needsInputCount: count(
        (g) => g.outcome === ContactUploadMatchOutcome.needs_input,
      ),
      skippedCount: count(
        (g) => g.outcome === ContactUploadMatchOutcome.skipped,
      ),
      invalidCount: count(
        (g) => g.outcome === ContactUploadMatchOutcome.invalid,
      ),
    }
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

  private async findOwnedUpload(
    organization: Organization,
    id: string,
  ): Promise<ContactUploadWithUser> {
    const upload = await this.model.findFirst({
      where: { id, organizationSlug: organization.slug },
      include: UPLOAD_USER_INCLUDE,
    })
    if (!upload) throw new NotFoundException('Upload not found')
    return upload
  }
}
