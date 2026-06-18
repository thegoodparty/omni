import { z } from 'zod'

// One Amplitude Experiment variant, resolved server-side by gp-api and consumed
// by gp-webapp to seed its client SDK. `value` is the variant key the webapp
// reads (e.g. 'on'/'off'); `key` mirrors it for parity with the client SDK's
// Variant shape. Kept loose on purpose — flags come and go.
export const ExperimentVariantSchema = z.object({
  value: z.string().optional(),
  key: z.string().optional(),
})

export type ExperimentVariant = z.infer<typeof ExperimentVariantSchema>

// The full variant map for the current user — every flag the deployment exposes,
// returned in a single server-side evaluation so the browser never has to reach
// Amplitude to know which gated surfaces to render.
export const ExperimentVariantsResponseSchema = z.object({
  variants: z.record(z.string(), ExperimentVariantSchema),
})

export type ExperimentVariantsResponse = z.infer<
  typeof ExperimentVariantsResponseSchema
>
