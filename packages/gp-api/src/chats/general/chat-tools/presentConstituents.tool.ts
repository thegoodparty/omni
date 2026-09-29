import { ConstituentRefSchema } from '@goodparty_org/contracts'
import type { LlmStreamTool } from '@/llm/services/llm.service'

export const buildPresentConstituentsTool = (): LlmStreamTool<
  typeof ConstituentRefSchema
> => ({
  description:
    "Present the official's OWN constituents: people already in their " +
    'contact records, by the contact ids a contact read returned. The ' +
    'neighbour who raised an issue, the group already running a program, ' +
    'the local leader whose backing would carry it. These are people an ' +
    'issue affects or who can rally others, and the note says in one line ' +
    'why these people and why now. Never use it for someone you found on ' +
    'the web. Somebody outside their records to call about fixing a ' +
    'problem is present_outside_contact.',
  inputSchema: ConstituentRefSchema,
  execute: () => ({ presented: true }),
})
