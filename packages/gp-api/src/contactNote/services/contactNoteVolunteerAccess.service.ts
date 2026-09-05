import { Injectable, NotFoundException } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { OutreachAssignmentService } from '@/outreach/services/outreachAssignment.service'
import { OrganizationRole } from '../../generated/prisma'
import { ContactNoteService } from './contactNote.service'

// Gives a volunteer notes CRUD scoped to the people they can actually reach
// (ENG-11057) — the same assignment-scoped, 404-not-403 pattern as
// PhoneBankingAccessService (ENG-11050): an unassigned volunteer must not
// learn the note or the person exists. No-op for owner/campaignAdmin. A
// volunteer may CRUD any note on a reachable person, including ones a
// manager authored — notes carry no per-author ownership for managers
// either, and reach is already narrowed to the volunteer's assignments.
//
// OutreachAssignmentService is resolved lazily via ModuleRef rather than
// injected: ContactNoteModule is imported by ContactsModule, and
// OutreachModule forwardRefs ContactsModule back in — a second forwardRef
// here can't break that cycle (same reasoning as
// OrganizationTeamService.resolveOutreachAssignments).
@Injectable()
export class ContactNoteVolunteerAccessService {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly contactNoteService: ContactNoteService,
  ) {}

  private resolveOutreachAssignments(): OutreachAssignmentService {
    return this.moduleRef.get(OutreachAssignmentService, { strict: false })
  }

  async assertAccessToPerson(
    organizationSlug: string,
    personId: string,
    role: OrganizationRole,
    userId: number,
  ): Promise<void> {
    if (role !== OrganizationRole.volunteer) return

    const assigned = await this.resolveOutreachAssignments().existsForPerson(
      organizationSlug,
      personId,
      userId,
    )
    if (!assigned) {
      throw new NotFoundException('Note not found')
    }
  }

  // PATCH/DELETE address a note, not a person — resolve the note within the
  // org first (org-scoped, matching updateByIdAndOrganizationSlug /
  // deleteByIdAndOrganizationSlug) and check the note's own personId, so a
  // cross-org note id 404s here before an assignment lookup even runs.
  async assertAccessToNote(
    noteId: string,
    organizationSlug: string,
    role: OrganizationRole,
    userId: number,
  ): Promise<void> {
    if (role !== OrganizationRole.volunteer) return

    const note = await this.contactNoteService.findFirst({
      where: { id: noteId, organizationSlug },
    })
    if (!note) {
      throw new NotFoundException('Note not found')
    }
    await this.assertAccessToPerson(
      organizationSlug,
      note.personId,
      role,
      userId,
    )
  }
}
