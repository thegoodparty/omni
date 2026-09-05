import { NotFoundException } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { OutreachAssignmentService } from '@/outreach/services/outreachAssignment.service'
import { OrganizationRole } from '../../generated/prisma'

// Resolved lazily via ModuleRef rather than injected: DoorKnockingModule and
// OutreachModule already close a multi-module cycle (DoorKnocking -> Contacts
// -> Campaigns -> Peerly -> Outreach -> DoorKnocking) that a single forwardRef
// can't break — same reasoning as OrganizationTeamService.removeMember.
//
// A volunteer's whole door-knocking surface is scoped to turfs whose envelope
// they hold an OutreachAssignment on (ENG-11048); manager+ roles are
// unrestricted, so this is a no-op for anyone but a volunteer. ONE shared
// predicate for all six volunteer-admitted routes (turf get/complete, route
// serve, interactions, do-not-knock, not-a-voter) rather than five copies of
// the same existsFor check.
//
// A missing assignment 404s rather than 403s, matching the org-scope miss
// every other door-knocking read already 404s on: a volunteer probing a
// teammate's turf id learns nothing about whether it exists.
export const assertVolunteerAssignedToOutreach = async (
  moduleRef: ModuleRef,
  role: OrganizationRole | undefined,
  outreachId: number,
  userId: number,
  notFoundMessage: string,
): Promise<void> => {
  if (role !== OrganizationRole.volunteer) return
  const assignments = moduleRef.get(OutreachAssignmentService, {
    strict: false,
  })
  const assigned = await assignments.existsFor(outreachId, userId)
  if (!assigned) {
    throw new NotFoundException(notFoundMessage)
  }
}
