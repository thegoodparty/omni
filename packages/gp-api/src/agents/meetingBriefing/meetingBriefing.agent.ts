import type { ModuleRef } from '@nestjs/core'
import { MeetingBriefingsService } from '@/meetings/services/meetingBriefings.service'
import { checkLink } from '@/agents/tools/checkLink'
import { fetchPage } from '@/agents/tools/fetchPage'
import { readDocument } from '@/agents/tools/readDocument'
import { searchDocument } from '@/agents/tools/searchDocument'
import { webSearch } from '@/agents/tools/webSearch'
import { defineAgent } from '@/agents/defineAgent'
import {
  type MeetingBriefing,
  MeetingBriefingSchema,
} from './meetingBriefing.schema'
import {
  AgendaSchema,
  type BriefingInput,
  BriefingInputSchema,
  PacketNotesSchema,
} from './meetingBriefingStages.schema'
import { officialPriorities } from './officialPriorities.tool'
import { queryVoters } from './queryVoters.tool'

const MODEL = 'claude-sonnet-4-6'

const saveBriefing = async (
  artifact: MeetingBriefing,
  run: { runId: string; input: BriefingInput },
  moduleRef: ModuleRef,
): Promise<void> => {
  await moduleRef
    .get(MeetingBriefingsService, { strict: false })
    .saveAgentBriefing({
      runId: run.runId,
      electedOfficeId: run.input.electedOfficeId,
      organizationSlug: run.input.organizationSlug,
      artifact,
    })
}

export const meetingBriefingAgent = defineAgent({
  input: BriefingInputSchema,
  output: MeetingBriefingSchema,
  onArtifact: saveBriefing,
  stages: {
    findAgenda: {
      prompt: 'meeting-briefing/find-agenda.md',
      model: MODEL,
      tools: [webSearch, fetchPage, checkLink],
      reads: ['input'],
      output: AgendaSchema,
      next: (state) =>
        AgendaSchema.parse(state.findAgenda).found
          ? 'readPacket'
          : 'writeBriefing',
    },
    readPacket: {
      prompt: 'meeting-briefing/read-packet.md',
      model: MODEL,
      tools: [readDocument, searchDocument, officialPriorities],
      reads: ['input', 'findAgenda'],
      output: PacketNotesSchema,
      next: 'writeBriefing',
    },
    writeBriefing: {
      prompt: 'meeting-briefing/write-briefing.md',
      model: MODEL,
      tools: [queryVoters, webSearch, fetchPage, checkLink],
      reads: ['input', 'findAgenda', 'readPacket'],
      output: MeetingBriefingSchema,
    },
  },
})

export const meetingBriefingSingleStageAgent = defineAgent({
  input: BriefingInputSchema,
  output: MeetingBriefingSchema,
  onArtifact: saveBriefing,
  stages: {
    meetingBriefing: {
      prompt: 'meeting-briefing.md',
      model: MODEL,
      tools: [
        webSearch,
        fetchPage,
        checkLink,
        readDocument,
        searchDocument,
        officialPriorities,
        queryVoters,
      ],
      reads: ['input'],
      output: MeetingBriefingSchema,
    },
  },
})
