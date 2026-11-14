import { MeetingBriefingsService } from '@/meetings/services/meetingBriefings.service'
import { checkLink } from '@/agents/tools/checkLink'
import { fetchPage } from '@/agents/tools/fetchPage'
import { readDocument } from '@/agents/tools/readDocument'
import { searchDocument } from '@/agents/tools/searchDocument'
import { webSearch } from '@/agents/tools/webSearch'
import { defineAgent } from '@/agents/defineAgent'
import { MeetingBriefingSchema } from './meetingBriefing.schema'
import { BriefingInputSchema } from './meetingBriefingInput.schema'
import { officialPriorities } from './officialPriorities.tool'
import { queryVoters } from './queryVoters.tool'

export const meetingBriefingAgent = defineAgent({
  input: BriefingInputSchema,
  output: MeetingBriefingSchema,
  model: 'claude-sonnet-4-6',
  prompt: 'meeting-briefing.md',
  tools: [
    webSearch,
    fetchPage,
    checkLink,
    readDocument,
    searchDocument,
    officialPriorities,
    queryVoters,
  ],
  onArtifact: async (artifact, run, moduleRef) => {
    await moduleRef
      .get(MeetingBriefingsService, { strict: false })
      .saveAgentBriefing({
        runId: run.runId,
        electedOfficeId: run.input.electedOfficeId,
        organizationSlug: run.input.organizationSlug,
        artifact,
      })
  },
})
