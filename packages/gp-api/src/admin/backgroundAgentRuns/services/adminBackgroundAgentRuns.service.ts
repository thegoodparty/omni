import { Injectable } from '@nestjs/common'
import { AgentMessage, AgentRun, Prisma } from '../../../generated/prisma'
import {
  BackgroundAgentMessage,
  BackgroundAgentRunDetail,
  BackgroundAgentRunListItem,
  BackgroundAgentRunsListQuery,
  PaginatedList,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { isJsonObject } from '@/shared/util/objects.util'
import {
  DEFAULT_PAGINATION_LIMIT,
  DEFAULT_PAGINATION_OFFSET,
} from '@/shared/constants/paginationOptions.consts'

const durationSeconds = (
  startedAt: Date | null,
  finishedAt: Date | null,
): number | null =>
  startedAt && finishedAt
    ? Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000)
    : null

// A run's input is the agent's validated input object, and its artifact is the
// last accepted submitOutput. Both are JsonB columns typed `unknown` here, so
// narrow before handing them to a schema that promises an object.
const asJsonObject = (value: unknown): Record<string, unknown> => {
  if (isJsonObject(value)) return value
  return {}
}

const asArtifact = (value: unknown): Record<string, unknown> | null =>
  isJsonObject(value) ? value : null

const toListItem = (run: AgentRun): BackgroundAgentRunListItem => ({
  runId: run.id,
  agentName: run.agentName,
  organizationSlug: run.organizationSlug,
  status: run.status,
  durationSeconds: durationSeconds(run.startedAt, run.finishedAt),
  createdAt: run.createdAt,
})

const toMessage = (message: AgentMessage): BackgroundAgentMessage => ({
  index: message.index,
  role: message.role,
  parts: Array.isArray(message.parts) ? message.parts : [],
  model: message.model,
  inputTokens: message.inputTokens,
  outputTokens: message.outputTokens,
  cacheReadTokens: message.cacheReadTokens,
  cacheWriteTokens: message.cacheWriteTokens,
  createdAt: message.createdAt,
})

@Injectable()
export class AdminBackgroundAgentRunsService extends createPrismaBase(
  MODELS.AgentRun,
) {
  async list({
    offset = DEFAULT_PAGINATION_OFFSET,
    limit = DEFAULT_PAGINATION_LIMIT,
    agentName,
    status,
    organizationSlug,
    createdAfter,
    createdBefore,
  }: BackgroundAgentRunsListQuery): Promise<
    PaginatedList<BackgroundAgentRunListItem>
  > {
    const where: Prisma.AgentRunWhereInput = {
      ...(agentName ? { agentName } : {}),
      ...(status ? { status } : {}),
      ...(organizationSlug ? { organizationSlug } : {}),
      ...(createdAfter || createdBefore
        ? {
            createdAt: {
              ...(createdAfter ? { gte: createdAfter } : {}),
              ...(createdBefore ? { lte: createdBefore } : {}),
            },
          }
        : {}),
    }

    const [runs, total] = await Promise.all([
      this.model.findMany({
        where,
        orderBy: { createdAt: Prisma.SortOrder.desc },
        skip: offset,
        take: limit,
      }),
      this.model.count({ where }),
    ])

    return { data: runs.map(toListItem), meta: { total, offset, limit } }
  }

  // The messages are the transcript a resume reads: `index` order, never
  // timestamps, because two rows written in one step can share one.
  async detail(runId: string): Promise<BackgroundAgentRunDetail> {
    const run = await this.model.findUniqueOrThrow({ where: { id: runId } })
    const messages = await this.client.agentMessage.findMany({
      where: { agentRunId: runId },
      orderBy: { index: Prisma.SortOrder.asc },
    })

    return {
      runId: run.id,
      agentName: run.agentName,
      organizationSlug: run.organizationSlug,
      status: run.status,
      input: asJsonObject(run.input),
      artifact: asArtifact(run.artifact),
      error: run.error,
      shapeHash: run.shapeHash,
      durationSeconds: durationSeconds(run.startedAt, run.finishedAt),
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      messages: messages.map(toMessage),
    }
  }
}
