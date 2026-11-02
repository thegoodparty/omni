import type { ManagedCivicPanelStatus } from '@/generated/prisma'
import {
  EVENTS,
  type SegmentTrackEventProperties,
} from 'src/vendors/segment/segment.types'

// Contacts - Civic Panel Status Changed, for whoever moved it: the official
// from their page, someone setting it by hand, or the wave job.
export const managedPanelStatusChanged = (change: {
  from: ManagedCivicPanelStatus
  to: ManagedCivicPanelStatus
  members: number
  changedBy: 'official' | 'manual' | 'system'
}): [string, SegmentTrackEventProperties] => [
  EVENTS.Contacts.CivicPanelStatusChanged,
  change,
]
