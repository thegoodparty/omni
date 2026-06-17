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

export interface PriorityRecord {
  id: string
  title: string
  description: string
  targetDate: string | null
  archivedAt: string | null
}

export interface CreatePriorityInput {
  electedOfficeId: string
  title: string
  description: string
  targetDate?: string | null
}

export interface UpdatePriorityInput {
  electedOfficeId: string
  id: string
  title?: string
  description?: string
  targetDate?: string | null
}

export interface PrioritiesToolPort {
  listActive: (electedOfficeId: string) => Promise<PriorityRecord[]>
  create: (input: CreatePriorityInput) => Promise<PriorityRecord>
  update: (input: UpdatePriorityInput) => Promise<PriorityRecord>
  archive: (electedOfficeId: string, id: string) => Promise<void>
}

export const PRIORITIES_PORT = 'COS_PRIORITIES_PORT'
