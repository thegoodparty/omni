import { z } from 'zod'
import { isValid, parseISO } from 'date-fns'

export const OrdinanceCodeSourceSchema = z.object({
  host_type: z.enum([
    'municode',
    'ecode360',
    'american_legal',
    'codepublishing',
    'encodeplus',
    'municipalcodeonline',
    'city_gov',
    'other',
  ]),
  url: z.string().min(1),
  edition_or_date: z.string().nullish(),
  client_id: z.string().nullish(),
  product_id: z.string().nullish(),
})

const CodeCaptureFileSchema = z.object({
  path: z.string(),
  byte_size: z.number(),
  content_type: z.string(),
  source_url: z.string(),
})

export const OrdinanceArtifactSchema = z
  .object({
    schema_version: z.literal(1),
    organization_slug: z.string().min(1),
    generated_for_run_id: z.string().min(1),
    generated_at: z
      .string()
      .refine(
        (value) => isValid(parseISO(value)),
        'generated_at must be an ISO datetime',
      ),
    jurisdiction: z.object({
      state: z.string().min(1),
      place: z.string().min(1),
      verified_evidence: z.string(),
    }),
    code_found: z.boolean(),
    // Nullable only when the run found nothing to point at; a found:false
    // uncodified result still carries a pointer to where ordinances live.
    code_source: OrdinanceCodeSourceSchema.nullable(),
    confidence: z.enum(['high', 'medium', 'low']),
    // A plain string in this contract — NOT the {overall, ...} object other
    // experiments emit.
    data_quality: z.enum([
      'ok',
      'partial',
      'uncodified',
      'not_found',
      'ambiguous',
    ]),
    toc: z
      .array(z.object({ title: z.string(), number: z.string().optional() }))
      .optional(),
    code_capture: z.object({
      saved: z.boolean(),
      files: z.array(CodeCaptureFileSchema),
      note: z.string().nullish(),
    }),
  })
  // Mirror the manifest's allOf invariant: a found result must carry the
  // source it was found at, so a code_found:true artifact with a null
  // code_source is malformed, not a valid uncodified pointer.
  .superRefine((artifact, ctx) => {
    if (artifact.code_found && artifact.code_source === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['code_source'],
        message: 'code_found true requires a code_source',
      })
    }
  })

export type OrdinanceArtifact = z.infer<typeof OrdinanceArtifactSchema>
