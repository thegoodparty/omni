import { Injectable, NotFoundException } from '@nestjs/common'
import {
  CreatePriorityInput,
  PrioritiesToolPort,
  PriorityRecord,
  UpdatePriorityInput,
} from './prioritiesPort'

// INTEGRATION SEAM — slice 1 owns the real Priority model + PrioritiesService.
// That service is NOT on this branch, so we register this placeholder against
// PRIORITIES_PORT to keep the CoS handler + crud_priorities tool buildable and
// testable in isolation (tests inject their own mock port instead).
//
// AT MERGE (after slice 1 lands):
//   1. Slice 1's PrioritiesService already matches PrioritiesToolPort
//      (listActive / create / update / archive, keyed on electedOfficeId).
//   2. In chief-of-staff.module.ts, replace this adapter in the PRIORITIES_PORT
//      provider with PrioritiesService (import it from slice 1's module and
//      add that module to imports), then delete this file.
//   3. priorities.tool.ts from slice 1, if it exists, supersedes
//      crudPriorities.tool.ts — reconcile to a single tool at merge.
//
// Until then this throws, so a CoS chat that calls crud_priorities surfaces a
// clear "not wired" error rather than silently succeeding.
const notWired = (): never => {
  throw new NotFoundException(
    'Priorities are not available yet (slice 1 not merged).',
  )
}

@Injectable()
export class PlaceholderPrioritiesAdapter implements PrioritiesToolPort {
  listActive(_electedOfficeId: string): Promise<PriorityRecord[]> {
    return Promise.resolve([])
  }

  create(_input: CreatePriorityInput): Promise<PriorityRecord> {
    return Promise.resolve(notWired())
  }

  update(_input: UpdatePriorityInput): Promise<PriorityRecord> {
    return Promise.resolve(notWired())
  }

  archive(_electedOfficeId: string, _id: string): Promise<void> {
    return Promise.resolve(notWired())
  }
}
