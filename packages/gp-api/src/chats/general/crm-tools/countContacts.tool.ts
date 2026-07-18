import { BadRequestException } from '@nestjs/common'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import type { Organization } from '../../../generated/prisma'
import {
  PRO_FILTERING_REQUIRED_MESSAGE,
  type ContactsService,
} from '@/contacts/services/contacts.service'
import { voterFilterBaseSchema } from '@/shared/schemas/voterFilterBase.schema'

export type CountContactsOutput = { count: number } | { error: string }

// Business-rule rejections (pro gate, Serve party rejection, unresolvable
// district) come back as structured tool errors the model can relay; anything
// else (people-api outages -> BadGatewayException) propagates to the LLM
// layer's tool-failure handling like every other tool.
const toToolError = (error: BadRequestException): { error: string } =>
  error.message === PRO_FILTERING_REQUIRED_MESSAGE
    ? {
        error:
          `${PRO_FILTERING_REQUIRED_MESSAGE}. Suggest upgrading to Pro ` +
          'to unlock voter data filtering.',
      }
    : { error: error.message }

// The input is the SAME Zod shape POST /v1/contacts/count consumes
// (CountContactsDTO wraps voterFilterBaseSchema), and execution goes through
// the same ContactsService.countContacts, so every service guard — the Win
// pro gate, the Serve party-filter rejection, per-channel activity-outcome
// validation — is inherited, never re-implemented. Aggregate-only: the return
// is a number or an error, never person rows.
export const buildCountContactsTool = (deps: {
  contacts: Pick<ContactsService, 'countContacts'>
  organization: Organization
}): LlmStreamTool<typeof voterFilterBaseSchema> => ({
  description:
    'Count the contacts matching a filter, using the same filter shape and ' +
    'rules as the saved-list builder. Input fields must come from ' +
    'describe_filter_dimensions — call it first. Returns { count } only, ' +
    'never individual records. Returns a structured error instead of a ' +
    'count when the organization cannot run the filter (e.g. a Win campaign ' +
    'without Pro, or a political-party filter on an elected-office ' +
    'organization).',
  inputSchema: voterFilterBaseSchema,
  execute: async (input): Promise<CountContactsOutput> => {
    try {
      return {
        count: await deps.contacts.countContacts(input, deps.organization),
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        return toToolError(error)
      }
      throw error
    }
  },
})
