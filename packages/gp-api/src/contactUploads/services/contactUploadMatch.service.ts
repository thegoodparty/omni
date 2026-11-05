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
      hasActivity: await this.hasActivity(organization.slug, [personId]),
    }
  }

  // The people this upload added that no other upload of the org points at:
  // the people undoing it removes. A person an earlier upload added, or a
  // voter-file person, stays.
  async newPeopleOnlyIn(
    organizationSlug: string,
    uploadId: string,
  ): Promise<string[]> {
    const rows = await this.client.$queryRaw<{ personId: string }[]>`
      SELECT DISTINCT m.person_id AS "personId"
      FROM contact_upload_match m
      WHERE m.upload_id = ${uploadId}
        AND m.is_new_person
        AND m.person_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM contact_upload_match o
          WHERE o.organization_slug = ${organizationSlug}
            AND o.person_id = m.person_id
            AND o.upload_id <> m.upload_id
        )
    `
    return rows.map((row) => row.personId)
  }

  // Notes, statuses, interactions or outreach recorded against any of these
  // people. Change match and undo leave them where they are.
  async hasActivity(
    organizationSlug: string,
    personIds: string[],
  ): Promise<boolean> {
    if (personIds.length === 0) return false
    const [activity] = await this.client.$queryRaw<{ exists: boolean }[]>`
      SELECT (
        EXISTS (SELECT 1 FROM contact_note
          WHERE organization_slug = ${organizationSlug}
            AND person_id = ANY(${personIds}))
        OR EXISTS (SELECT 1 FROM contact_status_event
          WHERE organization_slug = ${organizationSlug}
            AND person_id = ANY(${personIds}))
        OR EXISTS (SELECT 1 FROM contact_interaction_door_knock
          WHERE organization_slug = ${organizationSlug}
            AND person_id = ANY(${personIds}))
        OR EXISTS (SELECT 1 FROM contact_interaction_text
          WHERE organization_slug = ${organizationSlug}
            AND person_id = ANY(${personIds}))
        OR EXISTS (SELECT 1 FROM contact_interaction_robocall
          WHERE organization_slug = ${organizationSlug}
            AND person_id = ANY(${personIds}))
        OR EXISTS (SELECT 1 FROM contact_interaction_phone_banking
          WHERE organization_slug = ${organizationSlug}
            AND person_id = ANY(${personIds}))
        OR EXISTS (SELECT 1 FROM outreach_text_recipient
          WHERE organization_slug = ${organizationSlug}
            AND person_id = ANY(${personIds}))
      ) AS "exists"
    `
    return activity?.exists ?? false
  }
}
