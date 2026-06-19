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

// The full variant map for the current user, keyed by flag key. The key space
// is the open set of flags the Amplitude deployment exposes, so consumers treat
// it as a sparse lookup (a given flag may be absent) rather than a fixed shape.
export const ExperimentVariantsSchema = z.record(
  z.string(),
  ExperimentVariantSchema,
)

export type ExperimentVariants = z.infer<typeof ExperimentVariantsSchema>

// Resolved in a single server-side evaluation so the browser never has to reach
// Amplitude to know which gated surfaces to render.
export const ExperimentVariantsResponseSchema = z.object({
  variants: ExperimentVariantsSchema,
})

export type ExperimentVariantsResponse = z.infer<
  typeof ExperimentVariantsResponseSchema
>
