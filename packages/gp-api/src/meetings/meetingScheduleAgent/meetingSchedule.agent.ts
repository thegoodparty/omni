import { defineAgent } from '@/agents/defineAgent'
import { fetchPage } from '@/agents/tools/fetchPage'
import { renderPage } from '@/agents/tools/renderPage'
import { webSearch } from '@/agents/tools/webSearch'
import { MeetingBriefingsService } from '../services/meetingBriefings.service'
import { MEETING_SCHEDULE_PROMPT } from './meetingSchedule.prompt'
import {
  MeetingScheduleInputSchema,
  MeetingScheduleOutputSchema,
} from './meetingSchedule.schema'

// The meeting_schedule experiment on gp-api's own agents. The manifest's model
// is "sonnet" with thinking off.
export const meetingScheduleAgent = defineAgent({
  input: MeetingScheduleInputSchema,
  output: MeetingScheduleOutputSchema,
  model: 'claude-sonnet-4-6',
  prompt: MEETING_SCHEDULE_PROMPT,
  tools: { webSearch, fetchPage, renderPage },
  onArtifact: (output, run, { get }) =>
    get(MeetingBriefingsService).onScheduleArtifact(
      { runId: run.runId, organizationSlug: run.input.organizationSlug },
      output,
    ),
})
