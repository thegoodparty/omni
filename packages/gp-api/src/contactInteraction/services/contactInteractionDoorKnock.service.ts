import { Injectable } from '@nestjs/common'
import {
  VoterLikelihoodSchema,
  type VoterLikelihood,
} from '@goodparty_org/contracts'
import {
  ContactInteractionDoorKnock,
  ContactStatusField,
  ContactStatusSource,
  Prisma,
  WillVoteAnswer,
} from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ContactStatusService } from './contactStatus.service'

// PO-confirmed mapping (ENG-10841): a canvass answer is a strong-enough GOTV
// signal to record only for yes/no; `unsure` carries no signal and writes
// nothing. Exported so phone banking's call-outcome writer (ENG-10915)
// shares the exact same mapping rather than redefining it.
export const mapWillVoteToLikelihood = (
  willVote: WillVoteAnswer | null,
): VoterLikelihood | null => {
  switch (willVote) {
    case WillVoteAnswer.yes:
      return VoterLikelihoodSchema.enum.likely
    case WillVoteAnswer.no:
      return VoterLikelihoodSchema.enum.unlikely
    default:
      return null
  }
}

@Injectable()
export class ContactInteractionDoorKnockService extends createPrismaBase(
  MODELS.ContactInteractionDoorKnock,
) {
  constructor(private readonly contactStatus: ContactStatusService) {
    super()
  }

  async create(data: Prisma.ContactInteractionDoorKnockUncheckedCreateInput) {
    const row = await this.model.create({ data })
    await this.emitLikelihoodEvent(row)
    return row
  }

  // Idempotent write for the door-knocking tool's sync path. Keyed on the
  // (organizationSlug, sourceId) unique constraint so a re-sync upserts the
  // same row instead of double-writing — the dedupe is enforced at the DB,
  // not after a read, so concurrent retries can't race in a duplicate.
  // `sourceId` is required here; manual logs (null sourceId) use `create`.
  async recordIdempotent(
    data: Prisma.ContactInteractionDoorKnockUncheckedCreateInput & {
      sourceId: string
    },
  ) {
    const { organizationSlug, sourceId } = data
    const row = await this.model.upsert({
      where: {
        organizationSlug_sourceId: { organizationSlug, sourceId },
      },
      create: data,
      update: {
        personId: data.personId,
        occurredAt: data.occurredAt,
        outcome: data.outcome,
        supportAnswer: data.supportAnswer,
        willVote: data.willVote,
        note: data.note,
      },
    })
    await this.emitLikelihoodEvent(row)
    return row
  }

  // Shared by both write paths (tool sync via recordIdempotent, manual/CRM
  // via create) so the willVote->likelihood mapping and the door_knock
  // ContactStatusEvent shape live in one place. Manual logs never carry
  // willVote (LogDoorKnockInteractionSchema has no such field), so this is a
  // no-op there without needing a separate manual/sync branch.
  private async emitLikelihoodEvent(row: ContactInteractionDoorKnock) {
    const toValue = mapWillVoteToLikelihood(row.willVote)
    if (!toValue) {
      return
    }
    // Serve (`eo-`) orgs never carry voter_likelihood overrides (see
    // ContactsService.hasElectedOfficeAccess) — the door-knocking module has
    // no Win/Serve gate of its own, so this mirrors that invariant explicitly
    // rather than assuming Serve can't reach a door-knock write.
    if (row.organizationSlug.startsWith('eo-')) {
      return
    }
    await this.contactStatus.changeStatus({
      organizationSlug: row.organizationSlug,
      personId: row.personId,
      field: ContactStatusField.voter_likelihood,
      toValue,
      source: ContactStatusSource.door_knock,
      actorUserId: null,
      sourceId: row.sourceId ?? row.id,
      // No cheap local seed value is available here (the tool-sync path
      // doesn't re-fetch the person's Voter_Status on every knock, unlike
      // the manual-status PATCH endpoint) and fromValue is advisory-only
      // (used only for the very first override on this org/person/field,
      // purely to decorate the feed's "before" label) — not worth an extra
      // people-api round trip per synced knock.
      fallbackFromValue: null,
    })
  }
}
