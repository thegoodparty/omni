import { Injectable } from '@nestjs/common'
import { z } from 'zod'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  IS_NON_PROD_DEPLOY,
  VENDOR_MODE,
} from '@/shared/util/appEnvironment.util'
import { VendorMockVendor } from '@/generated/prisma'

export const EMAIL_AUDIENCE_FIXTURE_KIND = 'email_audience'

const EmailFixturePersonSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
})
export type EmailFixturePerson = z.infer<typeof EmailFixturePersonSchema>

export const EmailAudienceFixtureStateSchema = z.object({
  people: z.array(EmailFixturePersonSchema),
})

// A test organization's people with an email address, written by the
// test-fixtures route. Imported contacts reach the people DB through dev's
// database, which a preview's own database never feeds, so the email E2E
// stands its audience in here. Off unless the deploy mocks its vendors,
// which prod never does.
@Injectable()
export class PeopleEmailFixtureService extends createPrismaBase(
  MODELS.VendorMockRecord,
) {
  async emailAudienceFor(
    organizationSlug: string,
  ): Promise<EmailFixturePerson[] | null> {
    if (VENDOR_MODE !== 'mock' || !IS_NON_PROD_DEPLOY) return null
    const record = await this.model.findUnique({
      where: {
        vendor_kind_externalId: {
          vendor: VendorMockVendor.people_db,
          kind: EMAIL_AUDIENCE_FIXTURE_KIND,
          externalId: organizationSlug,
        },
      },
    })
    return record
      ? EmailAudienceFixtureStateSchema.parse(record.state).people
      : null
  }
}
