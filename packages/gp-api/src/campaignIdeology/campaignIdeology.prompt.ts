import { z } from 'zod'
import { type LlmMessage } from '@/llm/types/llmMessages.types'
import { IdeologyBucketSchema } from '@goodparty_org/contracts'

// Sonnet, not the Gemini Flash used for the campaign-story rewrite: this call
// is infrequent (lazy, hash-cached per campaign) and needs careful judgment
// on thin or ambiguous political text, where a cheaper model is far more
// likely to force a plausible-looking placement instead of abstaining.
export const CAMPAIGN_IDEOLOGY_MODELS: string[] = ['claude-sonnet-4-6']

export const IdeologyClassificationResponseSchema = z.object({
  bucket: IdeologyBucketSchema.nullable(),
  evidence: z.string(),
})
export type IdeologyClassificationResponse = z.infer<
  typeof IdeologyClassificationResponseSchema
>

export interface CandidateIdeologyInput {
  issues: string | null
  bio: string | null
  background: string | null
}

const SYSTEM_INSTRUCTION = [
  'You place an independent local political candidate on a three-value',
  'ideology axis — progressive, moderate, or conservative — based ONLY on',
  'text they wrote themselves.',
  '',
  'Rules, in order of importance:',
  '',
  '1. Abstain freely. Return bucket: null whenever the text is thin,',
  '   purely biographical, or genuinely does not place on this axis. Most',
  '   candidates write onboarding text that says nothing political — that is',
  '   normal, not a failure. A wrong placement is far worse than declining:',
  '   never default to "moderate" just because the text is ambiguous or the',
  '   candidate seems reasonable. "moderate" is a real, specific claim about',
  '   their positions, not a safe fallback for "I could not tell."',
  '2. Work only from the provided text. Do not use any outside or general',
  '   knowledge about this person, their party, their district, or their',
  '   race. Many of these candidates are locally known; ignore anything you',
  '   might already "know" about them.',
  '3. Cite your evidence. If you place them, name the specific stated',
  '   position(s) the placement rests on. If you abstain, say briefly why',
  '   the text does not place (e.g. "purely biographical, no stated',
  '   positions").',
  '',
  'Respond with ONLY a JSON object of this exact shape, no other text:',
  '{ "bucket": "progressive" | "moderate" | "conservative" | null,',
  '  "evidence": string }',
].join('\n')

const section = (label: string, text: string | null): string[] =>
  text ? [`${label}:`, text, ''] : []

export const buildCandidateIdeologyMessages = (
  input: CandidateIdeologyInput,
): LlmMessage[] => {
  const sections = [
    ...section("Stated issues (the candidate's own positions)", input.issues),
    ...section('Why they are running', input.bio),
    ...section('Background (biography only — weak signal)', input.background),
  ]

  const userContent = sections.length
    ? sections.join('\n')
    : 'The candidate has not written any onboarding text.'

  return [
    { role: 'system', content: SYSTEM_INSTRUCTION },
    { role: 'user', content: userContent },
  ]
}
