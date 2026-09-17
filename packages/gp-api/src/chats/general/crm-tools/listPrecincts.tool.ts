import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { z } from 'zod'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import type { Organization } from '../../../generated/prisma'
import {
  PRO_FILTERING_REQUIRED_MESSAGE,
  type ContactsService,
} from '@/contacts/services/contacts.service'
import { encodePrecinctPair } from '@goodparty_org/contracts'

// Strict so "takes no input" in the description stays true in code: any
// smuggled key (e.g. another org's slug) is rejected, not silently ignored.
const listPrecinctsInputSchema = z.object({}).strict()

// Named for the bucket the voter file leaves blank, so the model has
// something to call it. `getPrecincts` returns an empty `precinct` for the
// people in a county with no precinct on file — a real, selectable option
// rather than a null to skip, and in New Hampshire it is every single
// record. Left unlabelled, a model either drops it or invents a name.
export const NO_PRECINCT_LABEL = 'No precinct on file'

export interface PrecinctListing {
  county: string
  // Blank for the no-precinct-on-file bucket, exactly as the voter file has
  // it. Read `label` for something to say out loud.
  precinct: string
  label: string
  // Neutral noun on purpose: this tool is shared, and the two surfaces have
  // different vocabularies. A candidate has voters, an officeholder has
  // constituents, and a tool that says "voters" teaches the Chief of Staff
  // to say it too.
  people: number
  // The exact string the `precincts` filter field takes. Handed back rather
  // than left for the model to assemble: the wire format is an encoded
  // `county|precinct` pair, and a model building that by hand is a filter
  // that matches nobody while looking perfectly reasonable.
  value: string
}

export type ListPrecinctsOutput =
  | { precincts: PrecinctListing[]; truncated: boolean }
  | { error: string }

const toToolError = (
  error: BadRequestException | ForbiddenException,
): { error: string } =>
  error.message === PRO_FILTERING_REQUIRED_MESSAGE
    ? {
        error:
          `${PRO_FILTERING_REQUIRED_MESSAGE}. Suggest upgrading to Pro ` +
          'to unlock voter data filtering.',
      }
    : { error: error.message }

// The one dimension describe_filter_dimensions cannot carry. Every other
// dimension has a fixed vocabulary that ships in the catalog; a precinct's
// does not — it is per-district, a precinct number is only unique within its
// county, and a district holds anywhere from 0 to 579 of them. So the catalog
// omits precinct entirely and this enumerates it on demand instead.
//
// Aggregate-only, like every other CRM tool here: counties, precinct names and
// voter counts, never a person.
export const buildListPrecinctsTool = (deps: {
  contacts: Pick<ContactsService, 'getPrecincts'>
  organization: Organization
}): LlmStreamTool<typeof listPrecinctsInputSchema> => ({
  description:
    'List every precinct in this organization’s district, with its county ' +
    'and how many people it holds. Takes no input. Precinct is the one ' +
    'filter dimension describe_filter_dimensions does not carry, because ' +
    'its values differ per district — call this before composing any ' +
    'filter that mentions precincts, and pass each chosen precinct’s ' +
    '`value` verbatim into the `precincts` field. Never invent a precinct ' +
    'name; refer to one by its `label`. A precinct whose name is blank is ' +
    'the no-precinct-on-file bucket for that county — it is selectable like ' +
    'any other and can be most of a district, so never quietly drop it. ' +
    'Returns counties, precinct names and counts, never individual records.',
  inputSchema: listPrecinctsInputSchema,
  execute: async (): Promise<ListPrecinctsOutput> => {
    try {
      const { options, truncated } = await deps.contacts.getPrecincts(
        deps.organization,
      )
      return {
        precincts: options.map(({ county, precinct, voters }) => ({
          county,
          precinct,
          label: precinct || NO_PRECINCT_LABEL,
          people: voters,
          value: encodePrecinctPair(county, precinct),
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
