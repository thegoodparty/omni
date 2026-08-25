import { BadRequestException, ConflictException } from '@nestjs/common'
import { z } from 'zod'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import type { Organization } from '../../../generated/prisma'
import {
  PRO_FILTERING_REQUIRED_MESSAGE,
  type ContactsService,
} from '@/contacts/services/contacts.service'
import {
  FILTER_PRO_REQUIRED_MESSAGE,
  type VoterFileFilterService,
} from '@/voters/services/voterFileFilter.service'
import { voterFilterBaseSchema } from '@/shared/schemas/voterFilterBase.schema'
import { DATA_SOURCE_ROUTING_RULES } from '@/llm/tools/dataSourceRouting'

// Mirrors the webapp wizard's MAX_SEGMENT_NAME_LENGTH (client-enforced there);
// enforced here because the tool description promises the cap.
export const MAX_SAVED_FILTER_NAME_LENGTH = 40

// One tool covers all four operations, mirroring crud_priorities: a flat
// object schema (not a discriminated union on `action`) because Anthropic's
// tool input_schema must be a top-level `type: "object"`. Per-action required
// fields are enforced in execute below. The filter fields are the SAME Zod
// shape the voter-file filter routes consume (Create/UpdateVoterFileFilterSchema
// wrap voterFilterBaseSchema), so per-channel activity-outcome validity is
// inherited at parse time, never re-implemented.
const crudSavedFiltersInputSchema = voterFilterBaseSchema.extend({
  action: z.enum(['list', 'create', 'update', 'delete']),
  id: z.number().int().positive().optional(),
  name: z.string().min(1).max(MAX_SAVED_FILTER_NAME_LENGTH).optional(),
})

type SavedFilterRef = { id: number; name: string | null }

export type CrudSavedFiltersOutput =
  | { filters: SavedFilterRef[] }
  | (SavedFilterRef & { count?: number })
  | { deleted: true }
  | { error: string }

const LOCKED_FILTER_ERROR =
  'This list has already been used for outreach and is locked: it cannot ' +
  'be edited or deleted, only duplicated into a new list. Explain this to ' +
  'the user instead of retrying.'

// Business-rule rejections (pro gate, incomplete-outreach activity condition,
// Serve party rejection) come back as structured tool errors the model can
// relay; anything else (people-api outages -> BadGatewayException) propagates
// to the LLM layer's tool-failure handling like every other tool.
const toToolError = (error: BadRequestException): { error: string } =>
  error.message === PRO_FILTERING_REQUIRED_MESSAGE ||
  error.message === FILTER_PRO_REQUIRED_MESSAGE
    ? {
        error:
          `${PRO_FILTERING_REQUIRED_MESSAGE}. Suggest upgrading to Pro ` +
          'to unlock voter data filtering.',
      }
    : { error: error.message }

// Execution goes through the same VoterFileFilterService paths the
// voter-file filter routes use, so the Pro gate (filterAccessCheck), the
// completed-outreach validation, org scoping, and the locked-filter conflict
// are all inherited. Aggregate-only: returns carry ids, names, and counts,
// never person rows.
export const buildCrudSavedFiltersTool = (deps: {
  voterFileFilters: Pick<
    VoterFileFilterService,
    | 'create'
    | 'updateByIdAndOrganizationSlug'
    | 'deleteByIdAndOrganizationSlug'
    | 'findByOrganizationSlug'
    | 'findByIdAndOrganizationSlug'
    | 'filterAccessCheck'
  >
  contacts: Pick<ContactsService, 'countContacts'>
  organization: Organization
}): LlmStreamTool<typeof crudSavedFiltersInputSchema> => ({
  description:
    "Manage this organization's saved contact lists (saved filters). " +
    "action='list' returns { id, name } for every saved list; 'create' " +
    'saves a new list from the same filter shape count_contacts uses ' +
    '(requires name, max 40 characters; compose filter fields from ' +
    "describe_filter_dimensions) and returns { id, name, count }; 'update' " +
    'edits a list by id; ' +
    "'delete' removes a list by id. A list already used for outreach is " +
    'locked: update and delete return an error explaining it must be ' +
    'duplicated to change it. Returns ids, names, and counts only, never ' +
    'individual records, and returns a structured error when the ' +
    'organization cannot manage lists (e.g. a Win campaign without Pro).' +
    '\n\n' +
    DATA_SOURCE_ROUTING_RULES,
  inputSchema: crudSavedFiltersInputSchema,
  execute: async (input): Promise<CrudSavedFiltersOutput> => {
    const { voterFileFilters, contacts, organization } = deps
    const { action, id, name, ...filter } = input
    if (action === 'list') {
      const filters = await voterFileFilters.findByOrganizationSlug(
        organization.slug,
      )
      return { filters: filters.map(({ id, name }) => ({ id, name })) }
    }
    try {
      await voterFileFilters.filterAccessCheck(organization.slug)
      if (action === 'create') {
        if (!name) return { error: 'create requires name' }
        // Count before creating so a filter the org cannot count (non-Pro,
        // Serve party rejection, people-api outage) never leaves an orphan
        // list behind; the count is the same live number the route path
        // computes (the lists index always reads live counts).
        const { count } = await contacts.countContacts(filter, organization)
        const created = await voterFileFilters.create(organization.slug, {
          ...filter,
          name,
        })
        return { id: created.id, name: created.name, count }
      }
      if (id === undefined) return { error: `${action} requires id` }
      const existing = await voterFileFilters.findByIdAndOrganizationSlug(
        id,
        organization.slug,
      )
      if (!existing) {
        return {
          error: `No saved list with id ${id} exists for this organization`,
        }
      }
      if (action === 'update') {
        const payload = { ...filter, ...(name !== undefined && { name }) }
        if (Object.keys(payload).length === 0) {
          return {
            error:
              'update requires at least one field to change (name or a filter field)',
          }
        }
        const updated = await voterFileFilters.updateByIdAndOrganizationSlug(
          id,
          organization.slug,
          payload,
        )
        return { id: updated.id, name: updated.name }
      }
      await voterFileFilters.deleteByIdAndOrganizationSlug(
        id,
        organization.slug,
      )
      return { deleted: true }
    } catch (error) {
      if (error instanceof ConflictException) {
        return { error: LOCKED_FILTER_ERROR }
      }
      if (error instanceof BadRequestException) {
        return toToolError(error)
      }
      throw error
    }
  },
})
