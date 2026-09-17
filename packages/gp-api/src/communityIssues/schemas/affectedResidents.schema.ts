import { z } from 'zod'

// A factor score is null when that input was missing for that resident. The
// scoring rule drops a missing factor out of BOTH sides of the weighted average
// instead of scoring it zero, so null means "not scored on this", never "scored
// badly". It is the list's single biggest caveat and the UI must not render it
// as a 0.
const FactorScoreSchema = z.number().nullable()

// Factors are per-issue, and so are their keys. A rezoning scored on proximity,
// tenure and income shares no columns with a dwelling-type segment scored on a
// unit designator, a dwelling type and how many voters share an address. The
// list therefore declares its own factors and every resident's scores are keyed
// by those declarations, cross-checked in the refinement below. The first
// version of this schema hardcoded proximity/tenure/income and could not carry
// the second list at all.
const ScoringFactorSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  weight: z.number().positive(),
  rule: z.string().min(1),
})

// Epistemic, not a property of the person: how sure we are this resident
// belongs in the segment at all — how far inside the boundary they sit, whether
// that boundary is published or inferred, whether the geocode is trustworthy.
// Deliberately its own field rather than folded into the affectedness score,
// because folding uncertainty into a score makes both unreadable.
const ConfidenceSchema = z.object({
  score: z.number(),
  note: z.string(),
})

// L2 writes 01/01 as a year-only placeholder on a large share of records, so an
// age is either exact or good to about a year. Carrying the basis is what lets
// the UI show a soft number as soft, instead of implying a precision an age
// filter does not have.
const AgeSchema = z.object({
  years: z.number().int(),
  basis: z.enum(['exact', 'year-only']),
})

const AttributeSchema = z.object({
  label: z.string().min(1),
  value: z.string(),
})

export const AffectedResidentSchema = z.object({
  rank: z.number().int().positive(),
  name: z.string().min(1),
  address: z.string().min(1),
  city: z.string(),
  zip: z.string(),
  phone: z.string().min(1),
  phoneType: z.enum(['cell', 'landline']),
  lat: z.number(),
  lon: z.number(),
  // The affectedness read on its own, recomputable from factorScores and the
  // declared weights.
  affectednessScore: z.number(),
  // What actually froze the saved order, which is not always the same number.
  // When the two differ the issue's `rankingNote` has to say how, because a
  // reader sorting by one and reading the other will not be able to tell.
  rankingScore: z.number(),
  factorScores: z.record(z.string(), FactorScoreSchema),
  confidence: ConfidenceSchema.nullable(),
  age: AgeSchema.nullable(),
  // The human-readable inputs behind the score, rendered as a detail line. Free
  // labels rather than fixed columns for the same reason the factors are.
  attributes: z.array(AttributeSchema),
  why: z.string().min(1),
})

const GateSchema = z.object({
  label: z.string().min(1),
  detail: z.string().min(1),
})

const AffectedResidentsIssueSchema = z.object({
  // Which community issue this list belongs to, and which office owns it. Both
  // are checked against the request rather than trusted: the id keys the S3
  // object, so a mismatch means the wrong file was fetched.
  communityIssueId: z.string().min(1),
  organizationSlug: z.string().min(1),
  title: z.string().min(1),
  jurisdiction: z.string().min(1),
  runDate: z.string().min(1),
  sourceList: z.string().min(1),
  summary: z.string().min(1),
  // Why these people, for this issue. Not every issue is a distance to a site,
  // and stating the read is what stops the list reading as 310 unrelated names.
  affectednessRead: z.string().min(1),
  // Who is in the pool and who was removed, in order. Both gates change the
  // population, so both run before the ranking.
  gates: z.array(GateSchema).min(1),
  useCase: z.string().min(1),
  scoringRule: z.string().min(1),
  factors: z.array(ScoringFactorSchema).min(1),
  rankingNote: z.string().min(1),
  // Never optional. A score does not ship without the coverage caveats that
  // qualify it, so an empty array is a bug rather than a list with no caveats.
  caveats: z.array(z.string().min(1)).min(1),
})

export const AffectedResidentsListSchema = z
  .object({
    issue: AffectedResidentsIssueSchema,
    residents: z.array(AffectedResidentSchema).min(1),
  })
  .superRefine((list, ctx) => {
    const declared = new Set(list.issue.factors.map((f) => f.key))

    if (declared.size !== list.issue.factors.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['issue', 'factors'],
        message: 'factor keys must be unique',
      })
    }

    // A resident scored on a factor the issue never declared has no weight to
    // be scored against, and a declared factor missing from a resident is not
    // the same thing as a null one: null is a measured absence, missing is a
    // build error. Neither can be allowed through, because both corrupt the
    // "divide by the weight of the factors present" rule silently.
    list.residents.forEach((resident, index) => {
      const keys = Object.keys(resident.factorScores)
      for (const key of keys) {
        if (!declared.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['residents', index, 'factorScores', key],
            message: `resident scored on undeclared factor "${key}"`,
          })
        }
      }
      for (const key of declared) {
        if (!(key in resident.factorScores)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['residents', index, 'factorScores'],
            message: `missing declared factor "${key}" (use null for a measured absence)`,
          })
        }
      }
    })

    // Ranks are the frozen order of a list that may already have been handed to
    // an officeholder, so a gap or a repeat means the file is not the list it
    // claims to be.
    const ranks = list.residents.map((r) => r.rank)
    const contiguous = ranks.every((rank, index) => rank === index + 1)
    if (!contiguous) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['residents'],
        message: 'ranks must be contiguous and start at 1, in order',
      })
    }
  })

export type AffectedResidentsList = z.infer<typeof AffectedResidentsListSchema>
export type AffectedResident = z.infer<typeof AffectedResidentSchema>

export const AffectedResidentsResponseSchema = z.object({
  list: AffectedResidentsListSchema.nullable(),
})
