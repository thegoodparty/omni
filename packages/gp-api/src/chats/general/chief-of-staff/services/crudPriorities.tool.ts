import { z } from 'zod'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import { PriorityRecord, PrioritiesToolPort } from './prioritiesPort'

const isoDate = /^\d{4}-\d{2}-\d{2}$/

// One tool covers all four operations so the model has a single, discoverable
// surface for managing the official's priorities. The electedOfficeId is bound
// server-side (from resolved context), never taken from model input.
//
// A flat object schema (not a discriminated union on `action`) is required:
// Anthropic's tool input_schema must be a top-level `type: "object"`, and a
// union serializes to `anyOf` with no top-level type, which the API rejects.
// Per-action required fields are enforced in execute below.
const crudPrioritiesInputSchema = z.object({
  action: z.enum(['list', 'create', 'update', 'archive']),
  id: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  targetDate: z.string().regex(isoDate).nullable().optional(),
})

export type CrudPrioritiesOutput =
  | { priorities: PriorityRecord[] }
  | { priority: PriorityRecord }
  | { archived: true }
  | { error: string }

export const buildCrudPrioritiesTool = (deps: {
  port: PrioritiesToolPort
  electedOfficeId: string
}): LlmStreamTool<typeof crudPrioritiesInputSchema> => ({
  description:
    "Manage the official's durable policy/community priorities. " +
    "action='list' returns active priorities; 'create' adds one (requires " +
    "title and description); 'update' edits one by id; 'archive' " +
    'soft-deletes one by id. Priorities are long-lived context, not meeting ' +
    'task cards.',
  inputSchema: crudPrioritiesInputSchema,
  execute: async (input): Promise<CrudPrioritiesOutput> => {
    const { electedOfficeId, port } = deps
    if (input.action === 'list') {
      return { priorities: await port.listActive(electedOfficeId) }
    }
    if (input.action === 'create') {
      if (!input.title || !input.description) {
        return { error: 'create requires both title and description' }
      }
      return {
        priority: await port.create({
          electedOfficeId,
          title: input.title,
          description: input.description,
          ...(input.targetDate !== undefined && {
            targetDate: input.targetDate,
          }),
        }),
      }
    }
    if (input.action === 'update') {
      if (!input.id) return { error: 'update requires id' }
      return {
        priority: await port.update({
          electedOfficeId,
          id: input.id,
          ...(input.title !== undefined && { title: input.title }),
          ...(input.description !== undefined && {
            description: input.description,
          }),
          ...(input.targetDate !== undefined && {
            targetDate: input.targetDate,
          }),
        }),
      }
    }
    if (!input.id) return { error: 'archive requires id' }
    await port.archive(electedOfficeId, input.id)
    return { archived: true }
  },
})
