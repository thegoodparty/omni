import { Injectable, NotFoundException } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import {
  CONSTITUENT_FEEDBACK_DESIRED_OUTCOME_MAX_LENGTH,
  CONSTITUENT_FEEDBACK_ISSUE_LABEL_MAX_LENGTH,
  ConfirmConstituentFeedback,
  ConstituentFeedbackRecord,
  RecordConstituentFeedback,
  RecordConstituentFeedbackResponse,
} from '@goodparty_org/contracts'
import {
  ConstituentFeedbackChannel,
  ConstituentFeedbackExtractionStatus,
  ConstituentFeedbackStance,
  OrganizationRole,
  Prisma,
} from '@/generated/prisma'
import { assertVolunteerAssignedToOutreach } from '@/doorKnocking/utils/doorKnockingAccess.util'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  ConstituentFeedbackExtractionService,
  RawExtraction,
} from './constituentFeedbackExtraction.service'

// The model is told to answer short and nearly always does, but nothing
// makes it. The contract caps these two at 120 and 1000, and the response
// interceptor enforces that cap on the way out — so an overlong string would
// save the row and then 500 the request that saved it, leaving the canvasser
// looking at a capture failure for a memo that is safely on disk. Truncating
// keeps the record; the untruncated text stays in `proposed*` and in the
// transcript, so nothing the model said is actually lost.
const clamp = (value: string | null, max: number): string | null =>
  value === null || value.length <= max ? value : value.slice(0, max)

type ExtractionFields = {
  extractionStatus: ConstituentFeedbackExtractionStatus
  issueLabel: string | null
  stance: ConstituentFeedbackStance | null
  desiredOutcome: string | null
  extractionConfidence: number | null
  extractionModel: string | null
  proposedIssueLabel: string | null
  proposedStance: string | null
  proposedDesiredOutcome: string | null
}

const STANCE_BY_VALUE: Record<string, ConstituentFeedbackStance | undefined> =
  Object.fromEntries(
    Object.values(ConstituentFeedbackStance).map((stance) => [stance, stance]),
  )

// The model is prompted for one of these but is not bound to them, so an
// off-vocabulary answer becomes a null stance while `proposedStance` keeps
// what it actually said.
const toStance = (raw: string | null): ConstituentFeedbackStance | null =>
  raw === null ? null : (STANCE_BY_VALUE[raw] ?? null)

// What each channel's own write route tells a volunteer outside their
// assignment, so the memo routes never say more than the knock or call did.
const NOT_ASSIGNED_MESSAGE: Record<ConstituentFeedbackChannel, string> = {
  door_knock: 'Stop target not found',
  phone_bank: 'Phone banking list not found',
}

@Injectable()
export class ConstituentFeedbackService extends createPrismaBase(
  MODELS.ConstituentFeedback,
) {
  constructor(
    private readonly extraction: ConstituentFeedbackExtractionService,
    private readonly moduleRef: ModuleRef,
  ) {
    super()
  }

  async capture(input: {
    organizationSlug: string
    actorUserId: number
    role: OrganizationRole | undefined
    body: RecordConstituentFeedback
  }): Promise<RecordConstituentFeedbackResponse> {
    const target =
      input.body.channel === ConstituentFeedbackChannel.door_knock
        ? await this.resolveKnock(
            input.organizationSlug,
            input.body.knockClientKey,
            input.body.stopTargetId,
          )
        : await this.resolvePhoneBankCall(
            input.organizationSlug,
            input.body.entryId,
            input.body.personId,
          )

    // Before extraction, so a refused volunteer costs no model call.
    await this.assertVolunteerOnEffort(
      input.role,
      target.outreachId,
      input.actorUserId,
      input.body.channel,
    )

    const extracted = await this.extraction.extract({
      transcript: input.body.transcript,
      effortQuestion: target.effortQuestion,
      userId: input.actorUserId,
    })

    // One memo per interaction is the real invariant, and the two unique
    // indexes say so: `clientKey` is only a replay key. A client cannot be
    // relied on to re-send the same one — the phone panel keys its form on
    // personId, so switching tabs and re-recording mints a fresh uuid — and
    // keying the upsert on it alone would take the create branch and collide
    // on `phoneBankingInteractionId` instead of updating the row that is
    // already there. So resolve by the interaction first and fall back to the
    // replay key, which still covers a retry whose first attempt never landed.
    const existing = await this.findFirst({
      where: {
        organizationSlug: input.organizationSlug,
        ...(target.doorKnockInteractionId !== null
          ? { doorKnockInteractionId: target.doorKnockInteractionId }
          : { phoneBankingInteractionId: target.phoneBankingInteractionId }),
      },
      select: { id: true },
    })

    const row = await this.model.upsert({
      where:
        existing !== null
          ? { id: existing.id }
          : {
              organizationSlug_clientKey: {
                organizationSlug: input.organizationSlug,
                clientKey: input.body.clientKey,
              },
            },
      create: {
        organizationSlug: input.organizationSlug,
        clientKey: input.body.clientKey,
        personId: target.personId,
        occurredAt: new Date(),
        actorUserId: input.actorUserId,
        channel: input.body.channel,
        captureMethod: input.body.captureMethod,
        transcript: input.body.transcript,
        effortQuestion: target.effortQuestion,
        outreachId: target.outreachId,
        doorKnockInteractionId: target.doorKnockInteractionId,
        phoneBankingInteractionId: target.phoneBankingInteractionId,
        ...this.extractionFields(extracted),
      },
      // A re-record REPLACES the triple with a fresh model proposal, so any
      // confirmation the old one earned is void. Leaving `confirmedAt` set
      // would hand reporting a model guess wearing a human's signature, which
      // is the one thing the column exists to prevent.
      update: {
        transcript: input.body.transcript,
        captureMethod: input.body.captureMethod,
        // Re-read, not left at the first recording's value: the effort's
        // question can be edited between the two, and `extract()` above always
        // runs against the current one. Keeping the old copy here would leave
        // the row claiming a prompt the extraction never saw.
        effortQuestion: target.effortQuestion,
        outreachId: target.outreachId,
        confirmedAt: null,
        ...this.extractionFields(extracted),
      },
    })

    return {
      id: row.id,
      personId: row.personId,
      extractionStatus: row.extractionStatus,
      extraction:
        extracted === null
          ? null
          : {
              issueLabel: row.issueLabel,
              stance: row.stance,
              desiredOutcome: row.desiredOutcome,
            },
    }
  }

  // The confirmed triple replaces whatever the model proposed. `confirmedAt`
  // is what later reporting reads to tell a first-hand answer apart from an
  // unreviewed guess, so it is only ever set here.
  async confirm(input: {
    organizationSlug: string
    id: string
    actorUserId: number
    role: OrganizationRole | undefined
    body: ConfirmConstituentFeedback
  }): Promise<ConstituentFeedbackRecord> {
    const existing = await this.findFirst({
      where: { id: input.id, organizationSlug: input.organizationSlug },
      select: { outreachId: true, channel: true },
    })
    if (existing === null) throw new NotFoundException()
    await this.assertVolunteerOnEffort(
      input.role,
      existing.outreachId,
      input.actorUserId,
      existing.channel,
    )

    const row = await this.model.update({
      where: { id: input.id },
      data: {
        issueLabel: input.body.issueLabel,
        stance: input.body.stance,
        desiredOutcome: input.body.desiredOutcome,
        confirmedAt: new Date(),
      },
      include: { actor: { select: { firstName: true, lastName: true } } },
    })

    return this.toRecord(row)
  }

  async listForPerson(input: {
    organizationSlug: string
    personId: string
  }): Promise<ConstituentFeedbackRecord[]> {
    const rows = await this.findMany({
      where: {
        organizationSlug: input.organizationSlug,
        personId: input.personId,
      },
      orderBy: { occurredAt: Prisma.SortOrder.desc },
      include: { actor: { select: { firstName: true, lastName: true } } },
    })

    return rows.map((row) => this.toRecord(row))
  }

  // A volunteer acts only on an effort they hold an assignment on, the rule
  // the knock and call routes already apply; owners and campaign managers
  // pass. A memo with no effort has nothing to be assigned to, so a
  // volunteer cannot reach it at all.
  private async assertVolunteerOnEffort(
    role: OrganizationRole | undefined,
    outreachId: number | null,
    userId: number,
    channel: ConstituentFeedbackChannel,
  ): Promise<void> {
    if (role !== OrganizationRole.volunteer) return
    if (outreachId === null) {
      throw new NotFoundException(NOT_ASSIGNED_MESSAGE[channel])
    }
    await assertVolunteerAssignedToOutreach(
      this.moduleRef,
      role,
      outreachId,
      userId,
      NOT_ASSIGNED_MESSAGE[channel],
    )
  }

  private extractionFields(
    extracted: { extraction: RawExtraction; model: string } | null,
  ): ExtractionFields {
    return extracted === null
      ? {
          extractionStatus: ConstituentFeedbackExtractionStatus.failed,
          issueLabel: null,
          stance: null,
          desiredOutcome: null,
          extractionConfidence: null,
          extractionModel: null,
          proposedIssueLabel: null,
          proposedStance: null,
          proposedDesiredOutcome: null,
        }
      : {
          extractionStatus: ConstituentFeedbackExtractionStatus.extracted,
          issueLabel: clamp(
            extracted.extraction.issueLabel,
            CONSTITUENT_FEEDBACK_ISSUE_LABEL_MAX_LENGTH,
          ),
          stance: toStance(extracted.extraction.stance),
          desiredOutcome: clamp(
            extracted.extraction.desiredOutcome,
            CONSTITUENT_FEEDBACK_DESIRED_OUTCOME_MAX_LENGTH,
          ),
          extractionConfidence: extracted.extraction.confidence,
          extractionModel: extracted.model,
          proposedIssueLabel: extracted.extraction.issueLabel,
          proposedStance: extracted.extraction.stance,
          proposedDesiredOutcome: extracted.extraction.desiredOutcome,
        }
  }

  private toRecord(row: {
    id: string
    personId: string
    occurredAt: Date
    channel: ConstituentFeedbackChannel
    transcript: string | null
    issueLabel: string | null
    stance: ConstituentFeedbackStance | null
    desiredOutcome: string | null
    extractionStatus: ConstituentFeedbackExtractionStatus
    confirmedAt: Date | null
    outreachId: number | null
    actor: { firstName: string | null; lastName: string | null } | null
  }): ConstituentFeedbackRecord {
    const name = [row.actor?.firstName, row.actor?.lastName]
      .filter((part) => part !== null && part !== undefined && part !== '')
      .join(' ')

    return {
      id: row.id,
      personId: row.personId,
      occurredAt: row.occurredAt,
      channel: row.channel,
      transcript: row.transcript,
      issueLabel: row.issueLabel,
      stance: row.stance,
      desiredOutcome: row.desiredOutcome,
      extractionStatus: row.extractionStatus,
      confirmedAt: row.confirmedAt,
      outreachId: row.outreachId,
      actorName: name === '' ? null : name,
    }
  }

  private async resolveKnock(
    organizationSlug: string,
    knockClientKey: string,
    stopTargetId: number,
  ) {
    const knock = await this.client.contactInteractionDoorKnock.findUnique({
      where: {
        organizationSlug_sourceId: {
          organizationSlug,
          sourceId: knockClientKey,
        },
      },
      select: {
        id: true,
        personId: true,
        outreach: {
          select: {
            id: true,
            doorKnockingTurf: { select: { communityInputQuestion: true } },
          },
        },
      },
    })
    if (knock === null) throw new NotFoundException()

    // Scoped through the turf's own organization so a stop target from
    // another org cannot pull its question into this row.
    const target = await this.client.doorKnockingStopTarget.findFirst({
      where: {
        id: stopTargetId,
        personId: knock.personId,
        stop: { turf: { voterFileFilter: { organizationSlug } } },
      },
      select: {
        stop: {
          select: {
            turf: {
              select: {
                communityInputQuestion: true,
                outreach: { select: { id: true } },
              },
            },
          },
        },
      },
    })
    if (target === null) throw new NotFoundException()

    // The knock's own envelope wins. It was resolved server-side when the
    // knock was written, where `stopTargetId` is only what the client sent
    // with the memo, and a person can sit in two turfs. The question comes
    // from the same envelope so the row never pairs one effort with
    // another's prompt. The stop target's turf covers knocks written before
    // the knock row kept its envelope.
    const outreachId = knock.outreach?.id ?? target.stop.turf.outreach?.id
    if (outreachId === undefined) throw new NotFoundException()
    const effortQuestion =
      knock.outreach === null
        ? target.stop.turf.communityInputQuestion
        : (knock.outreach.doorKnockingTurf?.communityInputQuestion ?? null)

    return {
      personId: knock.personId,
      doorKnockInteractionId: knock.id,
      phoneBankingInteractionId: null,
      effortQuestion,
      outreachId,
    }
  }

  private async resolvePhoneBankCall(
    organizationSlug: string,
    entryId: number,
    personId: string,
  ) {
    const entry = await this.client.phoneBankingListEntry.findFirst({
      where: { id: entryId, list: { organizationSlug } },
      select: {
        phoneBankingListId: true,
        list: {
          select: {
            communityInputQuestion: true,
            outreach: { select: { id: true } },
          },
        },
      },
    })
    if (entry === null) throw new NotFoundException()

    const call = await this.client.contactInteractionPhoneBanking.findUnique({
      where: {
        phoneBankingListId_personId: {
          phoneBankingListId: entry.phoneBankingListId,
          personId,
        },
      },
      select: { id: true, personId: true },
    })
    if (call === null) throw new NotFoundException()

    return {
      personId: call.personId,
      doorKnockInteractionId: null,
      phoneBankingInteractionId: call.id,
      effortQuestion: entry.list.communityInputQuestion,
      // A Win list created with no Campaign row is written without an
      // envelope, so a call can legitimately have no effort to file under.
      outreachId: entry.list.outreach?.id ?? null,
    }
  }
}
