'use client'

import { clientRequest } from 'gpApi/typed-request'
import type {
  CreatePriorityInput,
  Priority,
  UpdatePriorityInput,
} from '@goodparty_org/contracts'

export const listPriorities = async (): Promise<Priority[]> => {
  const res = await clientRequest('GET /v1/priorities', {})
  if (!res.ok) throw new Error('Could not load priorities')
  return res.data
}

export const createPriority = async (
  input: CreatePriorityInput,
): Promise<Priority> => {
  const res = await clientRequest('POST /v1/priorities', input)
  if (!res.ok) throw new Error('Could not save that priority')
  return res.data
}

export const updatePriority = async (
  id: string,
  input: UpdatePriorityInput,
): Promise<Priority> => {
  const res = await clientRequest('PUT /v1/priorities/:id', { id, ...input })
  if (!res.ok) throw new Error('Could not update that priority')
  return res.data
}

export const archivePriority = async (id: string): Promise<void> => {
  const res = await clientRequest('DELETE /v1/priorities/:id', { id })
  if (!res.ok) throw new Error('Could not remove that priority')
}

export const prioritizeCommunityIssue = async (
  id: string,
): Promise<Priority> => {
  const res = await clientRequest('POST /v1/community-issues/:id/prioritize', {
    id,
  })
  if (!res.ok) throw new Error('Could not add that issue to your priorities')
  return res.data
}
