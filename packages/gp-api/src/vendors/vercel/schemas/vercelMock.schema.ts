import { z } from 'zod'

// Shapes the Vercel mock stores and serves. Response schemas list every field
// the @vercel/sdk response model marks required (the SDK throws before our
// code sees a body that lacks one) plus the ones gp-api reads. Optional SDK
// fields are left off.

export const VERCEL_ORDER_STATUS = {
  pending: 'pending',
  completed: 'completed',
  failed: 'failed',
} as const
export const VercelOrderStatusSchema = z.enum([
  VERCEL_ORDER_STATUS.pending,
  VERCEL_ORDER_STATUS.completed,
  VERCEL_ORDER_STATUS.failed,
])
export type VercelOrderStatus = z.infer<typeof VercelOrderStatusSchema>

// Stored state of a kind='domain_order' record (externalId = orderId).
export const VercelOrderStateSchema = z.object({
  domainName: z.string(),
  status: VercelOrderStatusSchema,
  price: z.number(),
  years: z.number(),
  autoRenew: z.boolean(),
  boughtAt: z.number().nullable(),
})
export type VercelOrderState = z.infer<typeof VercelOrderStateSchema>

// Stored state of a kind='project_domain' record (externalId = domain name).
export const VercelProjectDomainStateSchema = z.object({
  name: z.string(),
  projectId: z.string(),
  verified: z.boolean(),
  createdAt: z.number(),
})
export type VercelProjectDomainState = z.infer<
  typeof VercelProjectDomainStateSchema
>

// Stored state of a kind='dns_record' record. externalId is
// `${domain}/${uid}`; M4-8's mock verify-live reads type, name and value.
export const VercelDnsRecordStateSchema = z.object({
  domain: z.string(),
  uid: z.string(),
  type: z.string(),
  name: z.string(),
  value: z.string(),
  mxPriority: z.number().optional(),
  ttl: z.number().optional(),
  createdAt: z.number(),
})
export type VercelDnsRecordState = z.infer<typeof VercelDnsRecordStateSchema>

export const VercelBuyRequestSchema = z.object({
  expectedPrice: z.number().optional(),
  years: z.number().optional(),
  autoRenew: z.boolean().optional(),
})

export const VercelAddProjectDomainRequestSchema = z.object({
  name: z.string().min(1),
})

export const VercelCreateDnsRecordRequestSchema = z.object({
  type: z.string(),
  name: z.string(),
  value: z.string(),
  mxPriority: z.number().optional(),
  ttl: z.number().optional(),
})

export const VercelPriceResponseSchema = z.object({
  years: z.number(),
  purchasePrice: z.number(),
  renewalPrice: z.number(),
  transferPrice: z.number(),
})

export const VercelBuyResponseSchema = z.object({
  orderId: z.string(),
  _links: z.record(
    z.string(),
    z.object({
      href: z.string(),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
    }),
  ),
})

export const VercelOrderResponseSchema = z.object({
  orderId: z.string(),
  status: z.enum(['draft', 'purchasing', 'completed', 'failed']),
  domains: z.array(
    z.object({
      purchaseType: z.literal('purchase'),
      autoRenew: z.boolean(),
      years: z.number(),
      domainName: z.string(),
      status: VercelOrderStatusSchema,
      price: z.number(),
    }),
  ),
})

export const VercelAuthCodeResponseSchema = z.object({ authCode: z.string() })

// GET v9 / POST v10 / POST verify all share these required fields.
export const VercelProjectDomainResponseSchema = z.object({
  name: z.string(),
  apexName: z.string(),
  projectId: z.string(),
  verified: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const VercelDomainSchema = z.object({
  suffix: z.boolean(),
  expiresAt: z.number().nullable(),
  verified: z.boolean(),
  nameservers: z.array(z.string()),
  intendedNameservers: z.array(z.string()),
  creator: z.object({
    username: z.string(),
    email: z.string(),
    id: z.string(),
  }),
  name: z.string(),
  teamId: z.string().nullable(),
  boughtAt: z.number().nullable(),
  createdAt: z.number(),
  id: z.string(),
  serviceType: z.enum(['external', 'na', 'zeit.world']),
  userId: z.string(),
})
export type VercelDomain = z.infer<typeof VercelDomainSchema>

export const VercelGetDomainResponseSchema = z.object({
  domain: VercelDomainSchema,
})

export const VercelGetDomainsResponseSchema = z.object({
  domains: z.array(VercelDomainSchema),
  pagination: z.object({
    count: z.number(),
    next: z.number().nullable(),
    prev: z.number().nullable(),
  }),
})

export const VercelDnsRecordSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  type: z.string(),
  value: z.string(),
  mxPriority: z.number().optional(),
  creator: z.string(),
  created: z.number().nullable(),
  updated: z.number().nullable(),
  createdAt: z.number().nullable(),
  updatedAt: z.number().nullable(),
  ttl: z.number().optional(),
})

export const VercelGetRecordsResponseSchema = z.object({
  records: z.array(VercelDnsRecordSchema),
  pagination: z.object({ next: z.number().nullable() }),
})

export const VercelCreateRecordResponseSchema = z.object({
  uid: z.string(),
  updated: z.number(),
})
