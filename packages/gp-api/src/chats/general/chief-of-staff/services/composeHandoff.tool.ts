import {
  COMPOSE_HANDOFF_CHANNEL_SCHEMAS,
  type ComposeHandoffChannel,
} from '@goodparty_org/contracts'
import type { z } from 'zod'
import type { LlmStreamTool } from '@/llm/services/llm.service'

// Anthropic requires a tool's input_schema to be a top-level object. The
// contract's discriminated union converts to a top-level anyOf, which the API
// rejects — killing every stream while the flag is on. So each caller binds
// to exactly one channel's object arm (COMPOSE_HANDOFF_CHANNEL_SCHEMAS), and
// that tool's execute rejects the other channel's payload — a chief-of-staff
// conversation can never hand off to win_social or vice versa. Generic over
// the channel (rather than typed as the union) so the returned inputSchema
// and execute narrow to the single arm the caller picked.
export const buildComposeHandoffTool = <TChannel extends ComposeHandoffChannel>(
  channel: TChannel,
): LlmStreamTool<(typeof COMPOSE_HANDOFF_CHANNEL_SCHEMAS)[TChannel]> => {
  const inputSchema = COMPOSE_HANDOFF_CHANNEL_SCHEMAS[channel]
  // TS cannot narrow a generic indexed access on an object literal: it
  // checks the returned shape against the union of every arm instead of
  // TChannel's own. The cast is sound regardless — at runtime inputSchema IS
  // the one schema this channel maps to, so execute only ever sees that
  // channel's payload shape.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return {
    description:
      'When the user asks to act on an answer — post about it, script it ' +
      'for outreach — call this tool with a drafted text and any context ' +
      'you know from the conversation. Never invent ids or ' +
      'platform-specific details; prefer omitting a field to guessing it. ' +
      'The result opens a prefilled compose drawer for the user to review ' +
      'before anything sends.',
    inputSchema,
    execute: (args: z.infer<typeof inputSchema>) => inputSchema.parse(args),
  } as unknown as LlmStreamTool<
    (typeof COMPOSE_HANDOFF_CHANNEL_SCHEMAS)[TChannel]
  >
}
