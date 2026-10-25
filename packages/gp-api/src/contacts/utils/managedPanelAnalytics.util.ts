import type { ManagedCivicPanelStatus } from '@/generated/prisma'
import {
  EVENTS,
  type SegmentTrackEventProperties,
} from 'src/vendors/segment/segment.types'

// Civic Panel - Managed Panel Status Changed, for whoever moved it: the
// official from their page, staff, or the wave job.
export const managedPanelStatusChanged = (change: {
  from: ManagedCivicPanelStatus
  to: ManagedCivicPanelStatus
  members: number
  changedBy: 'official' | 'staff' | 'system'
}): [string, SegmentTrackEventProperties] => [
  EVENTS.CivicPanel.ManagedPanelStatusChanged,
  change,
]
