'use server'

import { auth } from '@clerk/nextjs/server'
import type {
  DeleteJobDeadLettersResult,
  JobDeadLetter,
  PaginatedList,
  RedriveJobDeadLettersResult,
} from '@goodparty_org/contracts'
import { ROLES } from '@/lib/permissions'
import { extractApiErrorMessage } from '@/lib/utils/sdkError'
import { SdkError } from '@/shared/gpApi'
import { gpAction } from '@/shared/util/gpClient.util'

// A batch answers with per-entry failures rather than throwing them, but the
// request itself can still fail whole (a rejected token, an unreachable
// gp-api), so its result is either the batch report or why none happened.
export type BatchJobDeadLetterResult<T> = T | { error: string }

const requireAdmin = async (action: string): Promise<void> => {
  const { has } = await auth()
  if (!has?.({ role: ROLES.ADMIN })) {
    throw new Error(`Only admins can ${action}`)
  }
}

const failureMessage = (error: Error, fallback: string): string =>
  error instanceof SdkError
    ? extractApiErrorMessage(error, fallback)
    : error.message || fallback

export const listJobDeadLetters = async (params: {
  sourceQueue?: string
  offset: number
  limit: number
}): Promise<PaginatedList<JobDeadLetter>> => {
  await requireAdmin('read job dead letters')
  return gpAction((client) => client.adminJobDeadLetters.list(params))
}

export const listJobDeadLetterQueues = async (): Promise<string[]> => {
  await requireAdmin('read job dead letters')
  return gpAction((client) => client.adminJobDeadLetters.queues())
}

export const getJobDeadLetter = async (id: string): Promise<JobDeadLetter> => {
  await requireAdmin('read a job dead letter')
  return gpAction((client) => client.adminJobDeadLetters.get(id))
}

export const redriveJobDeadLetter = async (
  id: string
): Promise<{ error: string | null }> => {
  try {
    await requireAdmin('redrive a job dead letter')
    await gpAction((client) => client.adminJobDeadLetters.redrive(id))
    return { error: null }
  } catch (error) {
    return {
      error: failureMessage(error as Error, 'Failed to redrive the job'),
    }
  }
}

export const deleteJobDeadLetter = async (
  id: string
): Promise<{ error: string | null }> => {
  try {
    await requireAdmin('delete a job dead letter')
    await gpAction((client) => client.adminJobDeadLetters.delete(id))
    return { error: null }
  } catch (error) {
    return {
      error: failureMessage(error as Error, 'Failed to delete the dead letter'),
    }
  }
}

export const redriveJobDeadLetters = async (
  ids: string[]
): Promise<BatchJobDeadLetterResult<RedriveJobDeadLettersResult>> => {
  try {
    await requireAdmin('redrive job dead letters')
    return await gpAction((client) =>
      client.adminJobDeadLetters.redriveMany(ids)
    )
  } catch (error) {
    return {
      error: failureMessage(
        error as Error,
        'Failed to re-drive the selected jobs'
      ),
    }
  }
}

export const deleteJobDeadLetters = async (
  ids: string[]
): Promise<BatchJobDeadLetterResult<DeleteJobDeadLettersResult>> => {
  try {
    await requireAdmin('delete job dead letters')
    return await gpAction((client) =>
      client.adminJobDeadLetters.deleteMany(ids)
    )
  } catch (error) {
    return {
      error: failureMessage(
        error as Error,
        'Failed to delete the selected dead letters'
      ),
    }
  }
}
