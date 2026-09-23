import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { z } from 'zod'
import { encodePrecinctPair } from '@goodparty_org/contracts'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import type { Organization } from '../../../generated/prisma'
import {
  PRO_FEATURE_REQUIRED_MESSAGE,
  PRO_FILTERING_REQUIRED_MESSAGE,
  type ContactsService,
} from '@/contacts/services/contacts.service'

export type ListPrecinctsOutput =
  | {
      precincts: {
        value: string
        county: string
        precinct: string
        people: number
      }[]
      truncated: boolean
    }
  | { error: string }

// No input. The vocabulary is a property of the org's own district, so
// there is nothing for the model to choose and nothing it could get wrong.
const listPrecinctsInputSchema = z.object({}).strict()

// getPrecincts gates through assertProAccess, which words its refusal
// differently from the filtering gate the sibling tools hit. Matching only
// the filtering one meant a non-Pro caller got the refusal with no upgrade
// suggestion attached — the branch this tool was written to take never ran.
// Both are matched, and both come from the constants rather than a literal
// so neither can drift away from what actually throws.
const PRO_GATE_MESSAGES: readonly string[] = [
  PRO_FEATURE_REQUIRED_MESSAGE,
  PRO_FILTERING_REQUIRED_MESSAGE,
]

const toToolError = (
  error: BadRequestException | ForbiddenException,
): { error: string } =>
  PRO_GATE_MESSAGES.includes(error.message)
    ? {
        error:
          `${error.message}. Suggest upgrading to Pro to unlock voter ` +
          'data filtering.',
      }
    : { error: error.message }

// The one filter dimension whose values the catalog cannot carry.
//
// describe_filter_dimensions publishes each dimension's complete vocabulary,
// and precinct has none that is knowable in advance: the values belong to
// the org's district, and a precinct number is only unique inside its
// county. So precinct was left out of the catalog entirely rather than
// advertised without values, which would have the model inventing precinct
// names that match nobody. The cost of that was an assistant telling a
// holder their own precinct is not a thing it can filter on, while the
// wizard beside it offers exactly that filter.
//
// This closes it the way the catalog comment always said it would have to
// be closed: enumerate first, then list the dimension.
//
// `value` is the ENCODED county|precinct pair and is what belongs in the
// `precincts` filter field — verbatim, never reassembled. A bare precinct
// number repeats across counties (one Texas string appears in 72 of them),
// so the pair is the identity and the encoding is where that is enforced.
// `county` and `precinct` ride along so the model can talk about a precinct
// in the words the holder used.
export const buildListPrecinctsTool = (deps: {
  contacts: Pick<ContactsService, 'getPrecincts'>
  organization: Organization
}): LlmStreamTool<typeof listPrecinctsInputSchema> => ({
  description:
    "List the precincts in this organization's district, each with the " +
    'number of people in it. Returns { precincts: [{ value, county, ' +
    'precinct, people }], truncated }. Precinct is a real filter ' +
    'dimension but` is NOT in describe_filter_dimensions, because its ' +
    'values differ per district and can only be read here - so call this ' +
    'whenever a request that names a precinct, ward, or numbered sub-area of the ' +
    'district. Pass the `value` string through UNCHANGED as an entry ' +
    'in the `precincts` field of count_contacts or crud_saved_filters; it ' +
    'encodes the county the precinct belongs to, which a precinct number ' +
    'alone does not. An empty `precinct` is the real "no precinct on ' +
    'file" bucket, not a placeholder. Never guess a precinct value that ' +
    'this tool did not return.',
  inputSchema: listPrecinctsInputSchema,
  execute: async (): Promise<ListPrecinctsOutput> => {
    try {
      const { options, truncated } = await deps.contacts.getPrecincts(
        deps.organization,
      )
      return {
        precincts: options.map(({ county, precinct, voters }) => ({
          value: encodePrecinctPair(county, precinct),
          county,
          precinct,
          // Renamed on the way out: this tool serves Serve as well as Win,
          // and "voters" is a Win noun the Chief of Staff must not repeat.
          people: voters,
        })),
        truncated,
      }
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      ) {
        return toToolError(error)
      }
      throw error
    }
  },
})
