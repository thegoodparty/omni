import { OutsideContactSchema } from '@goodparty_org/contracts'
import type { LlmStreamTool } from '@/llm/services/llm.service'

export const buildPresentOutsideContactTool = (): LlmStreamTool<
  typeof OutsideContactSchema
> => ({
  description:
    "Present ONE person or office OUTSIDE the official's records to call " +
    "about a problem: the city attorney's office, the county engineer, the " +
    'state agency desk, the nonprofit that runs the shelter. Built from ' +
    'what you researched, never from a contact id. It is for somebody who ' +
    "can act on the problem, never for one of the official's own " +
    'constituents. Give the name, their role or organization, one ' +
    'line on why them, who to ask for when the official gets through, and ' +
    'a script they can read down the phone or send as written. Include ' +
    'every contact route you actually found and never invent one. If you ' +
    'found no email, phone or website, say so in prose instead of calling ' +
    'this. Call it once per person, and only when reaching them is the ' +
    'next real step.',
  inputSchema: OutsideContactSchema,
  execute: () => ({ presented: true }),
})
