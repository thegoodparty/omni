import { z } from 'zod'
import type { LlmStreamTool } from '@/llm/services/llm.service'

export interface PriorityView {
  id: string
  title: string
  description: string
  source: 'win_import' | 'user_stated'
  targetDate: string | null
}

export interface PrioritiesToolProvider {
  list: () => Promise<PriorityView[]>
  create: (input: {
    title: string
    description: string
    targetDate?: string | null
  }) => Promise<PriorityView>
  update: (
    id: string,
    patch: {
      title?: string
      description?: string
      targetDate?: string | null
    },
  ) => Promise<PriorityView | null>
  archive: (id: string) => Promise<boolean>
}

// Flat object schema (not a discriminatedUnion on `action`): Anthropic tool
// input_schema must be a top-level `type: "object"`, and a union serializes to
// `anyOf` with no top-level type, which the API rejects. Per-action required
// fields are enforced in execute.
const crudPrioritiesInputSchema = z.object({
  action: z.enum(['list', 'create', 'update', 'archive']),
  id: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  targetDate: z.string().date().nullish(),
})

export type CrudPrioritiesInput = z.infer<typeof crudPrioritiesInputSchema>

export const buildCrudPrioritiesTool = (deps: {
  provider: PrioritiesToolProvider
}): LlmStreamTool<typeof crudPrioritiesInputSchema> => ({
  description:
    "Manage the elected official's durable policy/community priorities. " +
    "Use action 'list' to read the active priorities, 'create' to add a " +
    'new one (title + description, optional targetDate as YYYY-MM-DD), ' +
    "'update' to edit an existing priority by id, and 'archive' to " +
    'soft-delete one by id. Priorities persist across conversations and ' +
    'are the official’s standing goals, not one-off tasks.',
  inputSchema: crudPrioritiesInputSchema,
  execute: async (input) => {
    switch (input.action) {
      case 'list':
        return deps.provider.list()
      case 'create':
        if (!input.title || !input.description) {
          return { error: 'create requires both title and description' }
        }
        return deps.provider.create({
          title: input.title,
          description: input.description,
          targetDate: input.targetDate,
        })
      case 'update': {
        if (!input.id) return { error: 'update requires id' }
        const updated = await deps.provider.update(input.id, {
          title: input.title,
          description: input.description,
          targetDate: input.targetDate,
        })
        return updated ?? { error: 'Priority not found', id: input.id }
      }
      case 'archive': {
        if (!input.id) return { error: 'archive requires id' }
        const archived = await deps.provider.archive(input.id)
        return archived
          ? { archived: true, id: input.id }
          : { error: 'Priority not found', id: input.id }
      }
    }
  },
})
