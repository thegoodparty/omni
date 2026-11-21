'use server'

import { auth } from '@clerk/nextjs/server'
import type { JobDeadLetter, PaginatedList } from '@goodparty_org/contracts'
import { ROLES } from '@/lib/permissions'
import { extractApiErrorMessage } from '@/lib/utils/sdkError'
import { SdkError } from '@/shared/gpApi'
import { gpAction } from '@/shared/util/gpClient.util'

export type RedriveJobDeadLetterResult = { error: string | null }

const requireAdmin = async (action: string): Promise<void> => {
  const { has } = await auth()
  if (!has?.({ role: ROLES.ADMIN })) {
    throw new Error(`Only admins can ${action}`)
  }
}

export const listJobDeadLetters = async (params: {
  sourceQueue?: string
  offset: number
  limit: number
}): Promise<PaginatedList<JobDeadLetter>> => {
  await requireAdmin('read job dead letters')
  return gpAction((client) => client.adminJobDeadLetters.list(params))
}

const QUEUE_OPTIONS_PAGE_SIZE = 100
const QUEUE_OPTIONS_MAX_PAGES = 20

export const listJobDeadLetterQueues = async (): Promise<string[]> => {
  await requireAdmin('read job dead letters')
  const queues = new Set<string>()
  for (let page = 0; page < QUEUE_OPTIONS_MAX_PAGES; page++) {
    const offset = page * QUEUE_OPTIONS_PAGE_SIZE
    const result = await gpAction((client) =>
      client.adminJobDeadLetters.list({
        offset,
        limit: QUEUE_OPTIONS_PAGE_SIZE,
      })
    )
    for (const deadLetter of result.data) {
      if (deadLetter.sourceQueue) queues.add(deadLetter.sourceQueue)
    }
    if (offset + QUEUE_OPTIONS_PAGE_SIZE >= result.meta.total) break
  }
  return [...queues].sort()
}

export const getJobDeadLetter = async (id: string): Promise<JobDeadLetter> => {
  await requireAdmin('read a job dead letter')
  return gpAction((client) => client.adminJobDeadLetters.get(id))
}

export const redriveJobDeadLetter = async (
  id: string
): Promise<RedriveJobDeadLetterResult> => {
  try {
    await requireAdmin('redrive a job dead letter')
    await gpAction((client) => client.adminJobDeadLetters.redrive(id))
    return { error: null }
  } catch (error) {
    return {
      error:
        error instanceof SdkError
          ? extractApiErrorMessage(error, 'Failed to redrive the job')
          : error instanceof Error
            ? error.message
            : 'Failed to redrive the job',
    }
  }
}
