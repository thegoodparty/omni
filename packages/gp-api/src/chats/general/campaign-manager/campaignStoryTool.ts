import { ForbiddenException } from '@nestjs/common'
import { z } from 'zod'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import type { RewriteCampaignStoryInput } from '@/campaignStory/schemas/rewriteCampaignStory.schema'
import {
  CampaignStoryIntakeService,
  StoryState,
} from './campaignStoryIntake.service'

// One tool covers the whole Campaign Story intake so the model has a single
// surface. campaignId + candidateName are bound server-side from context, never
// taken from model input. A flat object schema (not a discriminated union on
// `action`) is required — Anthropic's tool input_schema must be a top-level
// object; per-action fields are validated in execute.
const campaignStoryToolInputSchema = z.object({
  action: z.enum(['read', 'elaborate', 'save', 'generate']),
  // elaborate: 'why' | 'background' | 'issue'. save: 'why' | 'background' |
  // 'positions'. ('issue' elaborates one policy, paired with its title.)
  field: z.enum(['why', 'background', 'positions', 'issue']).optional(),
  text: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  positions: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().min(1),
      }),
    )
    .optional(),
})

export type CampaignStoryToolOutput =
  | { story: StoryState }
  | { rewrite: string }
  | { saved: 'why' | 'background' | 'positions' }
  | { generation: { status: string } }
  | { error: string }

export const buildCampaignStoryTool = (deps: {
  intake: CampaignStoryIntakeService
  campaignId: number
  candidateName: string
}): LlmStreamTool<typeof campaignStoryToolInputSchema> => ({
  description:
    "Read and fill in the candidate's Campaign Story, one answer at a time. " +
    "action='read' returns the current answers and which are still missing " +
    "(why, background, positions); 'elaborate' expands a rough answer via the " +
    "same 'Help me rewrite' AI the Story page uses (field 'why'|'background', " +
    "or 'issue' with a title for one policy; returns a suggestion to show the " +
    "candidate — do not save it without their OK); 'save' persists a " +
    "candidate-confirmed answer (field 'why'|'background' with text, or " +
    "'positions' with a positions array); 'generate' kicks off the campaign " +
    'plan + tracker once all three answers are saved. Only ever save or ' +
    'generate after the candidate confirms.',
  inputSchema: campaignStoryToolInputSchema,
  execute: async (input): Promise<CampaignStoryToolOutput> => {
    const { intake, campaignId, candidateName } = deps

    if (input.action === 'read') {
      return { story: await intake.read(campaignId) }
    }

    if (input.action === 'elaborate') {
      if (!input.text || !input.field || input.field === 'positions') {
        return {
          error:
            "elaborate requires text and field 'why', 'background', or 'issue'",
        }
      }
      const rewriteInput: RewriteCampaignStoryInput = {
        field: input.field,
        text: input.text,
        ...(input.field === 'issue' && input.title
          ? { title: input.title }
          : {}),
      }
      try {
        return await intake.elaborate(campaignId, rewriteInput, candidateName)
      } catch (error) {
        if (error instanceof ForbiddenException) {
          return { error: 'AI rewrite limit reached for this campaign.' }
        }
        throw error
      }
    }

    if (input.action === 'save') {
      if (input.field === 'why') {
        if (!input.text) return { error: 'save why requires text' }
        await intake.saveWhy(campaignId, input.text)
        return { saved: 'why' }
      }
      if (input.field === 'background') {
        if (!input.text) return { error: 'save background requires text' }
        await intake.saveBackground(campaignId, input.text)
        return { saved: 'background' }
      }
      if (input.field === 'positions') {
        if (!input.positions || input.positions.length === 0) {
          return {
            error: 'save positions requires a non-empty positions array',
          }
        }
        await intake.savePositions(campaignId, input.positions)
        return { saved: 'positions' }
      }
      return {
        error: "save requires field 'why', 'background', or 'positions'",
      }
    }

    return { generation: await intake.generate(campaignId) }
  },
})
