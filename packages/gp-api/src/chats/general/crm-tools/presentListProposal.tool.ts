import { ListProposalSchema } from '@goodparty_org/contracts'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import { voterFilterBaseSchema } from '@/shared/schemas/voterFilterBase.schema'

// The filter is the same strict shape count_contacts and crud_saved_filters
// take, so a list proposed here is one the create route will accept as is.
// The contract carries it loosely because the card only passes it through.
const presentListProposalInput = ListProposalSchema.extend({
  filters: voterFilterBaseSchema
    .omit({ registeredVoterTrue: true, registeredVoterFalse: true })
    .strict()
    .describe('The exact filter you counted with in count_contacts.'),
})

const listProposalResult = ({ count }: { count: number }) =>
  count === 0
    ? {
        error:
          'That filter counted nobody, so there is no list to save. ' +
          'Loosen or change it, count again, and offer it once it ' +
          'reaches people.',
      }
    : { presented: true }

// A display tool, like present_outreach_proposal: the args are the card, and
// execute only acks. Nothing is saved here. The list is created when the
// official presses the card's button, which is the confirmation a prose
// "Ready to save it?" used to ask for and a typed "yes" used to give.
export const buildPresentListProposalTool = (): LlmStreamTool<
  typeof presentListProposalInput
> => ({
  description:
    'Offer a list for the user to save, as a card with a Create list ' +
    'button. Count the audience with count_contacts first and pass that ' +
    'same filter as filters, with its count, a name of at most 40 ' +
    'characters named after the filters it actually applies, and one ' +
    'plain sentence on who it holds. Nothing is saved until the user ' +
    'presses the button, and once they do the card becomes the list on a ' +
    'map, where they can draw shapes to narrow it. Use it instead of ' +
    'asking whether to save a list, and never save one yourself.',
  inputSchema: presentListProposalInput,
  execute: listProposalResult,
})

// The Campaign Manager's card has no map yet: once saved it reads as created
// and links to the list in Voter Data.
export const buildCampaignManagerListProposalTool = (): LlmStreamTool<
  typeof presentListProposalInput
> => ({
  description:
    'Offer a list of voters for the candidate to save, as a card with a ' +
    'Create list button. Count the voters with count_contacts first and ' +
    'pass that same filter as filters, with its count, a name of at most ' +
    '40 characters named after the filters it actually applies, and one ' +
    'plain sentence on who it holds. Nothing is saved until the candidate ' +
    'presses the button, and once they do the card links to the list in ' +
    'Voter Data. Use it instead of asking whether to save a list, and ' +
    'never save one yourself.',
  inputSchema: presentListProposalInput,
  execute: listProposalResult,
})
