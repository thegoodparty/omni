import { z } from 'zod'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import {
  SanitizedBriefingArtifact,
  sanitizeBriefingArtifact,
} from './briefingSanitizer'
import { Prisma } from '../../../../generated/prisma'

export interface BriefingListItem {
  meetingDate: string
  meetingName: string | null
  status: string | null
}

// Reads the official's own briefings. The provider returns the JSONB artifact
// cache (no S3 fetch); get_briefing sanitizes it through the field allowlist
// before it can reach the model.
export interface BriefingReadProvider {
  list: () => Promise<BriefingListItem[]>
  getByDate: (meetingDate: string) => Promise<Prisma.JsonValue | null>
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/

const listBriefingsInputSchema = z.object({})

const getBriefingInputSchema = z.object({
  meetingDate: z.string().regex(isoDate),
})

export const buildListBriefingsTool = (deps: {
  provider: BriefingReadProvider
}): LlmStreamTool<typeof listBriefingsInputSchema> => ({
  description:
    'List your upcoming and recent meeting briefings (meeting date, ' +
    'meeting name, status). Use this to see which briefings exist before ' +
    'reading one in full.',
  inputSchema: listBriefingsInputSchema,
  execute: (): Promise<BriefingListItem[]> => deps.provider.list(),
})

export const buildGetBriefingTool = (deps: {
  provider: BriefingReadProvider
}): LlmStreamTool<typeof getBriefingInputSchema> => ({
  description:
    'Read the full briefing for one of your meetings by date ' +
    '(YYYY-MM-DD). Returns the executive summary, agenda items, and public ' +
    'sources. Call list_briefings first if you do not know the date.',
  inputSchema: getBriefingInputSchema,
  execute: async ({
    meetingDate,
  }): Promise<SanitizedBriefingArtifact | null> => {
    const artifact = await deps.provider.getByDate(meetingDate)
    return sanitizeBriefingArtifact(artifact)
  },
})
