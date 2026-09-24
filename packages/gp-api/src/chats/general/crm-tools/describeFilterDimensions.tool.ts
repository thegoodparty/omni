import { z } from 'zod'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import type { Organization } from '../../../generated/prisma'
import type { ContactsService } from '@/contacts/services/contacts.service'
import {
  FILTER_DIMENSION_PROVENANCE_RULES,
  type FilterDimension,
} from '@/contacts/filterDimensions.catalog'
import { DATA_SOURCE_ROUTING_RULES } from '@/llm/tools/dataSourceRouting'

// Strict so "takes no input" in the description stays true in code: any
// smuggled key (e.g. another org's slug) is rejected, not silently ignored.
const describeFilterDimensionsInputSchema = z.object({}).strict()

// The tools that take the filter shape this catalog describes. A handler
// passes the subset it registered, so the instruction line below names only
// tools the model can call in this session and never a gated one.
export const FILTER_CONSUMER_TOOL_NAMES = [
  'count_contacts',
  'crud_saved_filters',
] as const

export type FilterConsumerToolName = (typeof FILTER_CONSUMER_TOOL_NAMES)[number]

// The subset a handler registered, read off its tool record so the
// description follows the registration instead of restating its conditions.
export const registeredFilterConsumers = (
  registered: Record<string, unknown>,
): FilterConsumerToolName[] =>
  FILTER_CONSUMER_TOOL_NAMES.filter((name) => name in registered)

const prepareLine = (
  filterConsumers: readonly FilterConsumerToolName[],
): string =>
  filterConsumers.length === 0
    ? 'Call this before naming any dimension or value so you only name ' +
      'ones that actually exist — never invent one.'
    : `Call this before composing any filter for ${filterConsumers.join(
        ' or ',
      )} so you only use dimensions and values that actually exist — never ` +
      'invent one.'

export interface DescribeFilterDimensionsOutput {
  dimensions: FilterDimension[]
}

// Aggregate-only by construction: the output is the mode-filtered dimension
// catalog (keys, labels, allowed values) — never person rows. The
// organization is bound server-side from the resolved chat context, so the
// model can only ever describe its own org's vocabulary.
export const buildDescribeFilterDimensionsTool = (deps: {
  contacts: Pick<ContactsService, 'getFilterDimensions'>
  organization: Organization
  filterConsumers: readonly FilterConsumerToolName[]
}): LlmStreamTool<typeof describeFilterDimensionsInputSchema> => ({
  description:
    'List every contact-filter dimension available to this organization: ' +
    'dimension keys, allowed values, how each dimension came to exist ' +
    '(provenance), and the activity channels with their per-channel ' +
    'outcome vocabularies. Takes no input. ' +
    prepareLine(deps.filterConsumers) +
    '\n\n' +
    FILTER_DIMENSION_PROVENANCE_RULES +
    '\n\n' +
    DATA_SOURCE_ROUTING_RULES,
  inputSchema: describeFilterDimensionsInputSchema,
  execute: (): DescribeFilterDimensionsOutput => ({
    dimensions: deps.contacts.getFilterDimensions(deps.organization),
  }),
})
