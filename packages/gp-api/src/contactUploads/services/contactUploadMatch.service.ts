import { Injectable } from '@nestjs/common'
import type {
  ContactFieldSource,
  ContactSourcesResponse,
} from '@goodparty_org/contracts'
import {
  ContactUploadMatchOutcome,
  Organization,
  Prisma,
} from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'

// The rows that make an upload row part of a person: matched or added when
// the upload ran, or picked by hand in review.
export const PERSON_OUTCOMES = [
  ContactUploadMatchOutcome.matched,
  ContactUploadMatchOutcome.new,
  ContactUploadMatchOutcome.resolved,
]

const FEED_INCLUDE = {
  upload: { select: { id: true, name: true, createdAt: true } },
  resolvedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.ContactUploadMatchInclude

export type ContactUploadMatchForFeed = Prisma.ContactUploadMatchGetPayload<{
  include: typeof FEED_INCLUDE
}>

@Injectable()
export class ContactUploadMatchService extends createPrismaBase(
  MODELS.ContactUploadMatch,
) {
  // Every upload row pointing at this person. Unbounded on purpose: a person
  // has at most one row per upload in practice, so the person feed takes the
  // whole set rather than windowing it like the interaction channels.
  async findForActivityFeed(
    organizationSlug: string,
    personId: string,
  ): Promise<ContactUploadMatchForFeed[]> {
    return this.model.findMany({
      where: { organizationSlug, personId, outcome: { in: PERSON_OUTCOMES } },
      include: FEED_INCLUDE,
      orderBy: { id: Prisma.SortOrder.desc },
    })
  }

  async sourcesFor(
    organization: Organization,
    personId: string,
  ): Promise<ContactSourcesResponse> {
    const rows = await this.model.findMany({
      where: {
        organizationSlug: organization.slug,
        personId,
        outcome: { in: PERSON_OUTCOMES },
      },
      include: {
        upload: { select: { id: true, name: true, createdAt: true } },
      },
      orderBy: [
        { upload: { createdAt: Prisma.SortOrder.desc } },
        { rowIndex: Prisma.SortOrder.desc },
      ],
    })
    // A person gp-api minted has no constituent file behind the fields no
    // upload supplied.
    const fallback: ContactFieldSource | null = rows.some(
      (row) => row.isNewPerson,
    )
      ? null
      : { kind: 'constituent_file' }
    const sourceOf = (
      supplied: (row: (typeof rows)[number]) => boolean,
    ): ContactFieldSource | null => {
      const row = rows.find(supplied)
      return row
        ? {
            kind: 'upload',
            uploadId: row.upload.id,
            uploadName: row.upload.name,
            uploadedAt: row.upload.createdAt.toISOString(),
          }
        : fallback
    }
    const [activity] = await this.client.$queryRaw<{ exists: boolean }[]>`
      SELECT (
        EXISTS (SELECT 1 FROM contact_note
          WHERE organization_slug = ${organization.slug}
            AND person_id = ${personId})
        OR EXISTS (SELECT 1 FROM contact_status_event
          WHERE organization_slug = ${organization.slug}
            AND person_id = ${personId})
        OR EXISTS (SELECT 1 FROM contact_interaction_door_knock
          WHERE organization_slug = ${organization.slug}
            AND person_id = ${personId})
        OR EXISTS (SELECT 1 FROM contact_interaction_text
          WHERE organization_slug = ${organization.slug}
            AND person_id = ${personId})
        OR EXISTS (SELECT 1 FROM contact_interaction_robocall
          WHERE organization_slug = ${organization.slug}
            AND person_id = ${personId})
        OR EXISTS (SELECT 1 FROM contact_interaction_phone_banking
          WHERE organization_slug = ${organization.slug}
            AND person_id = ${personId})
        OR EXISTS (SELECT 1 FROM outreach_text_recipient
          WHERE organization_slug = ${organization.slug}
            AND person_id = ${personId})
      ) AS "exists"
    `
    return {
      fields: {
        email: sourceOf((row) => row.email !== null),
        cellPhone: sourceOf((row) => row.cellPhone !== null),
        landline: sourceOf((row) => row.landline !== null),
        address: sourceOf((row) => row.addressLine !== null),
      },
      uploadRows: rows.map((row) => ({
        rowId: row.id,
        uploadId: row.upload.id,
        uploadName: row.upload.name,
        uploadedAt: row.upload.createdAt.toISOString(),
      })),
      hasActivity: activity?.exists ?? false,
    }
  }
}
