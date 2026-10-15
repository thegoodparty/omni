import { z } from 'zod'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import type {
  OutreachReportBackService,
  ReportBackSend,
} from '@/outreach/services/outreachReportBack.service'
import { MIN_SERVE_SMS_RECIPIENTS } from '@/outreach/services/outreachServeSmsCreate.service'

const readReportBackInput = z.object({
  outreachId: z
    .number()
    .int()
    .optional()
    .describe('One send. Omit for every send whose replies are in.'),
})

export interface ReportBackRead extends ReportBackSend {
  // Whether a report back can go out through the app at all: a text needs
  // a minimum number of people.
  textable: boolean
}

export const buildReadReportBackTool = (deps: {
  reportBack: OutreachReportBackService
  organizationSlug: string
  electedOfficeId: string
  priorityId: string
}): LlmStreamTool<typeof readReportBackInput> => ({
  description:
    'Read the texts on this priority whose replies are in, for reporting ' +
    'back: who each went to (audience, the exact line a report back card ' +
    'uses), how many it reached, how many can still be texted (canReach, ' +
    'the count a report back card uses), how many answered, the top themes ' +
    'with how many people raised each, and the report back that already ' +
    'went out, if one has. Never ask the official any of this; read it here.',
  inputSchema: readReportBackInput,
  execute: async ({ outreachId }): Promise<{ sends: ReportBackRead[] }> => {
    const sends = await deps.reportBack.listForOffice(
      deps.organizationSlug,
      deps.electedOfficeId,
      {
        priorityId: deps.priorityId,
        ...(outreachId === undefined ? {} : { outreachId }),
      },
    )
    return {
      sends: sends.map((send) => ({
        ...send,
        textable: send.canReach >= MIN_SERVE_SMS_RECIPIENTS,
      })),
    }
  },
})

// Why a report back card cannot be shown, or null. Its audience is the send
// it reports on, so nothing else about who gets it may ride along, and the
// count and audience line have to be the ones the read gave.
export const checkReportBack = (
  input: {
    channel: string
    count: number
    audience: string
    message: string
    audienceFilters?: unknown
    savedFilterId?: number | null
    sampleSize?: number
    panelSampleSize?: number
    civicPanelAsk?: boolean
    stepId?: string
    side?: string
    widensOutreachIds?: number[]
  },
  send: ReportBackSend | undefined,
): string | null => {
  if (input.channel !== 'text') {
    return 'A report back is a text. Present it again with channel text.'
  }
  if (send === undefined) {
    return (
      "That send isn't one of this priority's texts with its replies in. " +
      'Take the outreachId from read_report_back.'
    )
  }
  if (send.reportBack !== null) {
    return (
      `A report back on that send already went out (${send.reportBack.sentOn ?? 'scheduled'}). ` +
      'Do not offer another.'
    )
  }
  const extras = [
    input.audienceFilters !== undefined && 'audienceFilters',
    input.savedFilterId != null && 'savedFilterId',
    input.sampleSize !== undefined && 'sampleSize',
    input.panelSampleSize !== undefined && 'panelSampleSize',
    input.civicPanelAsk !== undefined && 'civicPanelAsk',
    input.stepId !== undefined && 'stepId',
    input.side !== undefined && 'side',
    input.widensOutreachIds !== undefined && 'widensOutreachIds',
  ].filter((name): name is string => name !== false)
  if (extras.length > 0) {
    return (
      `A report back goes to everyone that send reached, so leave out ` +
      `${extras.join(', ')} and present it again.`
    )
  }
  if (send.canReach < MIN_SERVE_SMS_RECIPIENTS) {
    return (
      `Only ${send.canReach} of the people that send reached can still be ` +
      `texted, and a text needs at least ${MIN_SERVE_SMS_RECIPIENTS}. Do not ` +
      'present it; tell the official in one line.'
    )
  }
  if (input.count !== send.canReach || input.audience !== send.audience) {
    return (
      `Set audience to "${send.audience}" and count to ${send.canReach}, ` +
      'exactly as read_report_back gave them, and present it again.'
    )
  }
  return null
}
