// Integration seam for the priorities CRUD tool.
//
// Slice 1 (crud_priorities / Priority model) is NOT on this branch. To avoid a
// hard dependency we define the minimal port the tool needs here, matching the
// method surface of slice-1's PrioritiesService. The CoS module registers a
// provider for PRIORITIES_PORT.
//
// AT MERGE: slice 1's PrioritiesService implements this shape (listActive /
// create / update / archive, all keyed on electedOfficeId). Replace the
// placeholder provider in chief-of-staff.module.ts with PrioritiesService and
// drop this file's port in favor of importing slice 1's service type. See the
// note in chief-of-staff.module.ts.

import type {
  PriorityStepCheck,
  PriorityStepId,
} from '@goodparty_org/contracts'

// Where a priority stands in its own guided flow, so this surface can talk
// about it without running it. Only steps that carry a check are listed.
export interface PriorityFlowState {
  currentStep: PriorityStepId | null
  nextAction: string | null
  checks: Array<{ stepId: PriorityStepId; check: PriorityStepCheck }>
}

export interface PriorityRecord {
  id: string
  title: string
  description: string
  archivedAt: string | null
  // Present on listActive, which is what the context reads. A write returns
  // the record without it.
  flow?: PriorityFlowState
}

export interface CreatePriorityInput {
  electedOfficeId: string
  title: string
  description: string
}

export interface UpdatePriorityInput {
  electedOfficeId: string
  id: string
  title?: string
  description?: string
}

export interface PrioritiesToolPort {
  listActive: (electedOfficeId: string) => Promise<PriorityRecord[]>
  create: (input: CreatePriorityInput) => Promise<PriorityRecord>
  update: (input: UpdatePriorityInput) => Promise<PriorityRecord>
  archive: (electedOfficeId: string, id: string) => Promise<void>
}

export const PRIORITIES_PORT = 'COS_PRIORITIES_PORT'
