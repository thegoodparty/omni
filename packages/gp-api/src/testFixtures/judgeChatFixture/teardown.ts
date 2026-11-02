import { AnnotationResourceType, type PrismaClient } from '@/generated/prisma'
import {
  CONTACT_UPLOAD_FILE_SELECT,
  type ContactUploadFilesService,
} from '@/contactUploads/services/contactUploadFiles.service'
import { JUDGE_ORG_SLUG_PREFIX } from './seed'

// A remote preview database is several round trips away and this is a dozen
// of them, which is close enough to Prisma's 5s default to lose a teardown to
// it on a slow link.
const TEARDOWN_TRANSACTION_OPTIONS = { timeout: 30_000, maxWait: 10_000 }

// REMOVES A CASE'S FIXTURE, AND CANNOT BE AIMED AT ANYTHING ELSE. There is no
// argument that reaches a real organization: the slug is matched on the judge
// prefix AND on the caller's own user id in the same where clause, so a slug
// without the prefix matches nothing, and a judge slug owned by somebody else
// matches nothing either. Narrowing happens in the query rather than in a
// check above it, because a check can be skipped by the next caller and a
// where clause cannot.
//
// Returns whether a fixture was there to remove, so a sweep may call it twice
// — on a retry, or after a teardown that already ran — without an error that
// says nothing went wrong.
export const removeChatOrgFixture = (
  prisma: PrismaClient,
  contactUploadFiles: ContactUploadFilesService,
  userId: number,
  organizationSlug: string,
): Promise<boolean> =>
  prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findFirst({
      where: {
        slug: {
          equals: organizationSlug,
          startsWith: JUDGE_ORG_SLUG_PREFIX,
        },
        ownerId: userId,
      },
      select: { slug: true },
    })
    if (organization === null) return false

    const office = await tx.electedOffice.findUnique({
      where: { organizationSlug },
      select: { id: true },
    })
    if (office !== null) {
      const briefings = await tx.meetingBriefing.findMany({
        where: { electedOfficeId: office.id },
        select: { id: true },
      })
      // An annotation names its briefing in a plain string column rather than
      // a foreign key, so nothing cascades it, and the note is a row the
      // annotation points AT rather than one that hangs off it — so the note
      // outlives the annotation unless it goes too.
      const annotations = await tx.annotation.findMany({
        where: {
          authorUserId: userId,
          resourceType: AnnotationResourceType.briefing,
          resourceId: { in: briefings.map(({ id }) => id) },
        },
        select: { id: true, noteId: true },
      })
      await tx.annotation.deleteMany({
        where: { id: { in: annotations.map(({ id }) => id) } },
      })
      await tx.annotationNote.deleteMany({
        where: {
          id: { in: annotations.flatMap(({ noteId }) => noteId ?? []) },
        },
      })
      // MeetingBriefing RESTRICTS the delete of its ExperimentRun, and
      // deleting the organization cascades into both tables in an order
      // Postgres does not fix. Removing the briefings up here is what keeps
      // the cascade below off that restriction.
      await tx.meetingBriefing.deleteMany({
        where: { electedOfficeId: office.id },
      })
    }

    // No foreign key ties a conversation to its organization, so the rows a
    // driven turn wrote would outlive the fixture they were about.
    await tx.chatConversation.deleteMany({
      where: { ownerUserId: userId, organizationSlug },
    })
    // Everything left goes with the organization: the campaign, the elected
    // office and through it the ordinance, the priority and nothing else, the
    // ordinance code record, and the experiment run.
    const uploadFiles = await tx.contactUpload.findMany({
      where: { organizationSlug },
      select: CONTACT_UPLOAD_FILE_SELECT,
    })
    await tx.organization.delete({ where: { slug: organizationSlug } })
    await contactUploadFiles.deleteFiles(uploadFiles)
    return true
  }, TEARDOWN_TRANSACTION_OPTIONS)
