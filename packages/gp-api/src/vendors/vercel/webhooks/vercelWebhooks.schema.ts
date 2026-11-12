import { z } from 'zod'

// Inbound Vercel webhook bodies, trimmed to the fields we log. Shapes from
// https://vercel.com/docs/spend-management#webhook-payload and
// https://vercel.com/docs/webhooks/webhooks-api#alerts.triggered. Vercel does
// not document the `firewall.attack` payload, so only the envelope is checked.
const BudgetReachedEventSchema = z.object({
  id: z.string(),
  type: z.literal('budget.reached'),
  createdAt: z.number(),
  payload: z.object({
    teamId: z.string(),
    budgetAmount: z.number(),
    currentSpend: z.number(),
    thresholdPercent: z.number().int(),
  }),
})

const AlertsTriggeredEventSchema = z.object({
  id: z.string(),
  type: z.literal('alerts.triggered'),
  createdAt: z.number(),
  payload: z.object({
    projectId: z.string(),
    projectSlug: z.string().optional(),
    severity: z.string().optional(),
    links: z.object({ observability: z.string().optional() }).optional(),
    alerts: z
      .array(
        z.object({
          title: z.string().optional(),
          metric: z.string().optional(),
        }),
      )
      .optional(),
  }),
})

const FirewallAttackEventSchema = z.object({
  id: z.string(),
  type: z.literal('firewall.attack'),
  createdAt: z.number(),
  payload: z.object({
    projectId: z.string().optional(),
  }),
})

export const VercelWebhookEventSchema = z.discriminatedUnion('type', [
  BudgetReachedEventSchema,
  AlertsTriggeredEventSchema,
  FirewallAttackEventSchema,
])

export type VercelWebhookEvent = z.infer<typeof VercelWebhookEventSchema>
