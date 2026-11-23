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

const failureMessage = (error: unknown, fallback: string): string =>
  error instanceof SdkError
    ? extractApiErrorMessage(error, fallback)
    : error instanceof Error
      ? error.message
      : fallback

export const deleteJobDeadLetter = async (
  id: string
): Promise<RedriveJobDeadLetterResult> => {
  try {
    await requireAdmin('delete a job dead letter')
    await gpAction((client) => client.adminJobDeadLetters.delete(id))
    return { error: null }
  } catch (error) {
    return { error: failureMessage(error, 'Failed to delete the job') }
  }
}

export type BulkJobDeadLetterResult = { done: number; error: string | null }

export const redriveJobDeadLetters = async (
  ids: string[]
): Promise<BulkJobDeadLetterResult> => {
  let done = 0
  try {
    await requireAdmin('redrive job dead letters')
    for (const id of ids) {
      await gpAction((client) => client.adminJobDeadLetters.redrive(id))
      done += 1
    }
    return { done, error: null }
  } catch (error) {
    return { done, error: failureMessage(error, 'Failed to redrive the jobs') }
  }
}

export const deleteJobDeadLetters = async (
  ids: string[]
): Promise<BulkJobDeadLetterResult> => {
  let done = 0
  try {
    await requireAdmin('delete job dead letters')
    for (const id of ids) {
      await gpAction((client) => client.adminJobDeadLetters.delete(id))
      done += 1
    }
    return { done, error: null }
  } catch (error) {
    return { done, error: failureMessage(error, 'Failed to delete the jobs') }
  }
}
