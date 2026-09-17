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

export interface PrecinctListing {
  county: string
  precinct: string
  voters: number
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
    'and how many voters it holds. Takes no input. Precinct is the one ' +
    'filter dimension describe_filter_dimensions does not carry, because ' +
    'its values differ per district — call this before composing any ' +
    'filter that mentions precincts, and pass each chosen precinct’s ' +
    '`value` verbatim into the `precincts` field. Never invent a precinct ' +
    'name. Returns counties, precinct names and counts, never individual ' +
    'records.',
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
          voters,
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
