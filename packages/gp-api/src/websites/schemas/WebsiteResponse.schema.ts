import { DomainStatus, WebsiteStatus } from '../../generated/prisma'
import { z } from 'zod'
import { zCoerceDate } from '@goodparty_org/contracts'
import { GooglePlacesApiResponseSchema } from 'src/shared/schemas'

const WebsiteContentSchema = z
  .object({
    logo: z.string().optional(),
    theme: z.string().optional(),
    main: z
      .object({
        title: z.string().optional(),
        tagline: z.string().optional(),
        image: z.string().optional(),
      })
      .optional(),
    about: z
      .object({
        bio: z.string().optional(),
        issues: z
          .array(
            z.object({
              title: z.string().optional(),
              description: z.string().optional(),
            }),
          )
          .optional(),
        committee: z.string().optional(),
      })
      .optional(),
    contact: z
      .object({
        address: z.string().optional(),
        addressPlace: GooglePlacesApiResponseSchema.optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
      })
      .optional(),
  })
  .nullable()

const DomainSchema = z
  .object({
    id: z.number().int(),
    createdAt: zCoerceDate(),
    updatedAt: zCoerceDate(),
    name: z.string(),
    websiteId: z.number().int(),
    status: z.nativeEnum(DomainStatus),
    operationId: z.string().nullable(),
    price: z.number().nullable(),
    paymentId: z.string().nullable(),
    emailForwardingDomainId: z.string().nullable(),
    registrantVerifiedAt: zCoerceDate().nullable(),
  })
  .nullable()

export const MyWebsiteResponseSchema = z.object({
  id: z.number().int(),
  createdAt: zCoerceDate(),
  updatedAt: zCoerceDate(),
  campaignId: z.number().int(),
  status: z.nativeEnum(WebsiteStatus),
  hasEverBeenPublished: z.boolean(),
  vanityPath: z.string(),
  content: WebsiteContentSchema,
  domain: DomainSchema,
})

// Response shape for the anonymous public website endpoints (/:vanityPath/view
// and /by-domain/:domain). These serve published candidate sites to the open
// internet, so the response MUST NOT carry the campaign's financial/tax data
// (einNumber, subscriptionId, campaignCommittee, statementName, filing periods,
// etc.). Only the candidate's display name and the website content are public;
// this allowlist drops everything else, including the user's clerkId.
export const PublicWebsiteResponseSchema = z.object({
  id: z.number().int(),
  createdAt: zCoerceDate(),
  updatedAt: zCoerceDate(),
  campaignId: z.number().int(),
  status: z.nativeEnum(WebsiteStatus),
  vanityPath: z.string(),
  content: WebsiteContentSchema,
  campaign: z
    .object({
      user: z
        .object({
          firstName: z.string().nullable(),
          lastName: z.string().nullable(),
        })
        .nullable(),
    })
    .nullable(),
})
