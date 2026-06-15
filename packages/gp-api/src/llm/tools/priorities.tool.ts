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

const crudPrioritiesInputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }),
  z.object({
    action: z.literal('create'),
    title: z.string().min(1),
    description: z.string().min(1),
    targetDate: z.string().date().nullish(),
  }),
  z.object({
    action: z.literal('update'),
    id: z.string().min(1),
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    targetDate: z.string().date().nullish(),
  }),
  z.object({
    action: z.literal('archive'),
    id: z.string().min(1),
  }),
])

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
        return deps.provider.create({
          title: input.title,
          description: input.description,
          targetDate: input.targetDate,
        })
      case 'update': {
        const updated = await deps.provider.update(input.id, {
          title: input.title,
          description: input.description,
          targetDate: input.targetDate,
        })
        return updated ?? { error: 'Priority not found', id: input.id }
      }
      case 'archive': {
        const archived = await deps.provider.archive(input.id)
        return archived
          ? { archived: true, id: input.id }
          : { error: 'Priority not found', id: input.id }
      }
    }
  },
})
