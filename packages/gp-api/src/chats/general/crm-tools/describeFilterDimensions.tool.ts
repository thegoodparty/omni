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
}): LlmStreamTool<typeof describeFilterDimensionsInputSchema> => ({
  description:
    'List every contact-filter dimension available to this organization: ' +
    'dimension keys, allowed values, how each dimension came to exist ' +
    '(provenance), and the activity channels with their per-channel ' +
    'outcome vocabularies. Takes no input. Call this before composing any ' +
    'count_contacts filter so you only use dimensions and values that ' +
    'actually exist — never invent one.\n\n' +
    FILTER_DIMENSION_PROVENANCE_RULES +
    '\n\n' +
    DATA_SOURCE_ROUTING_RULES,
  inputSchema: describeFilterDimensionsInputSchema,
  execute: (): DescribeFilterDimensionsOutput => ({
    dimensions: deps.contacts.getFilterDimensions(deps.organization),
  }),
})
