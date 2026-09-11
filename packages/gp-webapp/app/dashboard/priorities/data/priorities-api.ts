'use client'

import { clientRequest } from 'gpApi/typed-request'
import type {
  CreatePriorityInput,
  Priority,
  UpdatePriorityInput,
} from '@goodparty_org/contracts'

export async function createPriority(
  input: CreatePriorityInput,
): Promise<Priority> {
  const res = await clientRequest('POST /v1/priorities', input)
  if (!res.ok) throw new Error('Could not save that priority')
  return res.data
}

export async function updatePriority(
  id: string,
  input: UpdatePriorityInput,
): Promise<Priority> {
  const res = await clientRequest('PUT /v1/priorities/:id', { id, ...input })
  if (!res.ok) throw new Error('Could not update that priority')
  return res.data
}

export async function archivePriority(id: string): Promise<void> {
  const res = await clientRequest('DELETE /v1/priorities/:id', { id })
  if (!res.ok) throw new Error('Could not remove that priority')
}

export async function prioritizeCommunityIssue(id: string): Promise<Priority> {
  const res = await clientRequest('POST /v1/community-issues/:id/prioritize', {
    id,
  })
  if (!res.ok) throw new Error('Could not add that issue to your priorities')
  return res.data
}
