import { z } from 'zod'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import { PriorityRecord, PrioritiesToolPort } from './prioritiesPort'

const isoDate = /^\d{4}-\d{2}-\d{2}$/

// One tool covers all four operations so the model has a single, discoverable
// surface for managing the official's priorities. The electedOfficeId is bound
// server-side (from resolved context), never taken from model input.
const crudPrioritiesInputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }),
  z.object({
    action: z.literal('create'),
    title: z.string().min(1),
    description: z.string().min(1),
    targetDate: z.string().regex(isoDate).nullable().optional(),
  }),
  z.object({
    action: z.literal('update'),
    id: z.string().min(1),
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    targetDate: z.string().regex(isoDate).nullable().optional(),
  }),
  z.object({
    action: z.literal('archive'),
    id: z.string().min(1),
  }),
])

export type CrudPrioritiesOutput =
  | { priorities: PriorityRecord[] }
  | { priority: PriorityRecord }
  | { archived: true }

export const buildCrudPrioritiesTool = (deps: {
  port: PrioritiesToolPort
  electedOfficeId: string
}): LlmStreamTool<typeof crudPrioritiesInputSchema> => ({
  description:
    "Manage the official's durable policy/community priorities. " +
    "action='list' returns active priorities; 'create' adds one; 'update' " +
    "edits one by id; 'archive' soft-deletes one by id. Priorities are " +
    'long-lived context, not meeting task cards.',
  inputSchema: crudPrioritiesInputSchema,
  execute: async (input): Promise<CrudPrioritiesOutput> => {
    const { electedOfficeId, port } = deps
    if (input.action === 'list') {
      return { priorities: await port.listActive(electedOfficeId) }
    }
    if (input.action === 'create') {
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
    await port.archive(electedOfficeId, input.id)
    return { archived: true }
  },
})
