import { z } from 'zod'

// The three-value bucket the ideology recommended-list variants match against
// the voter file's own `hf_ideology_general` column. A standalone leaf (no
// project imports) so both the campaign-ideology classifier that produces it
// and the recommended-lists registry that consumes it can import this file
// without either becoming the other's dependency.
export const IDEOLOGY_BUCKET_VALUES = [
  'progressive',
  'moderate',
  'conservative',
] as const
export const IdeologyBucketSchema = z.enum(IDEOLOGY_BUCKET_VALUES)
export type IdeologyBucket = z.infer<typeof IdeologyBucketSchema>
