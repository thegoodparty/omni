import { z } from 'zod'

// The self_research manifest's input_schema, in gp-api's names. Every field
// past the three required ones is a hint: a campaign with no race context
// dispatches with what it has, and the agent discovers the rest.
export const SelfResearchInputSchema = z.object({
  organizationSlug: z.string().min(1),
  fullName: z
    .string()
    .min(1)
    .describe(
      "The candidate's full name. The person this research is FOR. Used for " +
        'source discovery via webSearch and to confirm a fetched page is about ' +
        'this candidate, not a same-named person.',
    ),
  state: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .describe('2-letter state code (e.g. NC).'),
  city: z.string().min(1).nullish(),
  officeName: z
    .string()
    .min(1)
    .describe(
      'Readable office the candidate is running for (e.g. "Fayetteville ' +
        'City Council").',
    ),
  priorRoles: z.array(z.string().min(1)).default([]),
  websiteUrl: z.string().min(1).nullish(),
  socialUrls: z.array(z.string().min(1)).default([]),
  coverageUrls: z.array(z.string().min(1)).default([]),
})
export type SelfResearchInput = z.infer<typeof SelfResearchInputSchema>

const FindingSchema = z.strictObject({
  claim: z
    .string()
    .min(1)
    .describe(
      'The vulnerability stated plainly: what an opponent could attack the ' +
        "candidate on, grounded in the candidate's own public conduct.",
    ),
  source_url: z
    .string()
    .regex(/^https?:\/\//)
    .describe(
      'The page actually fetched: the finalUrl fetchPage or renderPage ' +
        'returned after any redirect.',
    ),
  source_extract: z
    .string()
    .min(1)
    .describe(
      'A verbatim passage from the fetched page that substantiates the claim. ' +
        'It MUST appear literally in the page text this run read.',
    ),
  category: z.enum([
    'residency',
    'record',
    'statements',
    'funding',
    'conflicts',
    'narrative',
  ]),
  drafted_response: z
    .string()
    .min(1)
    .describe(
      'A short, ready-to-use response the candidate could give if attacked on ' +
        'this. First person or neutral; honest, not spin.',
    ),
  source_title: z.string().min(1).optional(),
  occurred_at: z.iso.date().nullish(),
})

// The manifest's output_schema without generated_at, which gp-api stamps at
// persist (selfResearchArtifact): a model asked for the current time writes a
// plausible one, and the reader only ever reads the stamp.
export const SelfResearchOutputSchema = z.strictObject({
  findings: z.array(FindingSchema),
})
export type SelfResearchOutput = z.infer<typeof SelfResearchOutputSchema>

// The artifact the PMF Engine's run publishes, so the persist path and the
// judge read one shape from either engine.
export const selfResearchArtifact = (output: SelfResearchOutput) => ({
  generated_at: new Date().toISOString(),
  findings: output.findings,
})
