import { Injectable, NotFoundException } from '@nestjs/common'
import { z } from 'zod'
import { ChatScope } from '../../../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  ChatAnchorSchema,
  OrdinanceAuthoritySchema,
  OrdinanceClarifyAnswersSchema,
  OrdinanceComparablesSchema,
  OrdinanceScratchpadSchema,
  type OrdinanceAuthority,
  type OrdinanceClarifyAnswers,
  type OrdinanceComparables,
  type OrdinanceFlowStep,
  type OrdinanceScratchpad,
  type OrdinanceSeedType,
} from '@goodparty_org/contracts'

export interface OrdinanceFlowContext {
  conversationId: string
  ordinanceId: string
  electedOfficeId: string
  step: OrdinanceFlowStep
  organizationSlug: string
  officeTitle: string | null
  jurisdiction: string | null
  seedType: OrdinanceSeedType
  issueSlug: string | null
  goalText: string | null
  sourceLink: string | null
  clarifyAnswers: OrdinanceClarifyAnswers
  authority: OrdinanceAuthority | null
  comparables: OrdinanceComparables | null
  scratchpad: OrdinanceScratchpad | null
}

// Loads the ordinance_flow context: the conversation's anchored (ordinance,
// step), the owning office for governance framing, and the prior-step artifacts
// already persisted on the Ordinance record so the agent on the current step is
// aware of what earlier steps produced.
@Injectable()
export class OrdinanceFlowContextService extends createPrismaBase(
  MODELS.ChatConversation,
) {
  async load(
    conversationId: string,
    userId: number,
  ): Promise<OrdinanceFlowContext> {
    const conversation = await this.findFirst({
      where: {
        id: conversationId,
        ownerUserId: userId,
        scope: ChatScope.ordinance_flow,
        deletedAt: null,
      },
    })
    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }

    const anchorParsed = ChatAnchorSchema.safeParse(conversation.anchor)
    if (
      !anchorParsed.success ||
      anchorParsed.data.resourceType !== 'ordinance'
    ) {
      throw new NotFoundException('Ordinance anchor not found')
    }
    const anchor = anchorParsed.data

    // Scope the ordinance read to the caller's office so a conversation can't
    // surface another office's ordinance even if its anchor were tampered with.
    const { electedOffice, ordinance } = await this.resolveOwnedOrdinance(
      anchor.resourceId,
      userId,
      conversation.organizationSlug ?? '',
    )

    // Base jurisdiction from the code-sourcing agent's verified municipality.
    // The handler overrides it with the L2 district resolution when that
    // resolves, but many orgs (no positionId, no L2 district) never resolve —
    // without this fallback the authority step has to ask the user what city
    // and state the ordinance is for. codeFound: true only — on found:false
    // (NOT_FOUND/AMBIGUOUS) place/state echo the search input, not a verified
    // page, and a wrong jurisdiction is worse than asking.
    const codeRecord = await this.client.ordinanceCodeRecord.findFirst({
      where: {
        organizationSlug: electedOffice.organizationSlug,
        codeFound: true,
      },
    })

    return {
      conversationId,
      ordinanceId: ordinance.id,
      electedOfficeId: electedOffice.id,
      step: anchor.step,
      organizationSlug: electedOffice.organizationSlug,
      officeTitle: electedOffice.organization.customPositionName,
      jurisdiction: codeRecord
        ? `${codeRecord.place}, ${codeRecord.state}`
        : null,
      seedType: ordinance.seedType,
      issueSlug: ordinance.issueSlug,
      goalText: ordinance.goalText,
      sourceLink: ordinance.sourceLink,
      clarifyAnswers:
        this.parseJson(
          OrdinanceClarifyAnswersSchema,
          ordinance.clarifyAnswers,
        ) ?? [],
      authority: this.parseJson(OrdinanceAuthoritySchema, ordinance.authority),
      comparables: this.parseJson(
        OrdinanceComparablesSchema,
        ordinance.comparables,
      ),
      scratchpad: this.parseJson(
        OrdinanceScratchpadSchema,
        ordinance.scratchpad,
      ),
    }
  }

  // Authorize the create path before a ChatConversation is anchored to an
  // ordinance. resolveConversation calls this so a conversation record can never
  // be created for an ordinance the caller's office does not own — the same
  // invariant load() enforces on the message-send path.
  async assertOrdinanceOwnership(
    ordinanceId: string,
    userId: number,
    organizationSlug: string,
  ): Promise<void> {
    await this.resolveOwnedOrdinance(ordinanceId, userId, organizationSlug)
  }

  // Resolve the caller's office and the ordinance it owns, scoping the ordinance
  // read to that office so a tampered anchor can't reach another office's row.
  private async resolveOwnedOrdinance(
    ordinanceId: string,
    userId: number,
    organizationSlug: string,
  ) {
    const electedOffice = await this.client.electedOffice.findFirst({
      where: { userId, organizationSlug },
      include: { organization: true },
    })
    if (!electedOffice) {
      throw new NotFoundException('Elected office not found')
    }
    const ordinance = await this.client.ordinance.findFirst({
      where: {
        id: ordinanceId,
        electedOfficeId: electedOffice.id,
        deletedAt: null,
      },
    })
    if (!ordinance) {
      throw new NotFoundException('Ordinance not found')
    }
    return { electedOffice, ordinance }
  }

  // Defensively parse a persisted JSON artifact (the column is untyped JSON); a
  // shape mismatch degrades to null rather than failing the whole chat load.
  // V is inferred from the column so we never name the untyped value.
  private parseJson<S extends z.ZodType, V>(
    schema: S,
    value: V,
  ): z.infer<S> | null {
    if (value === null || value === undefined) return null
    const parsed = schema.safeParse(value)
    if (!parsed.success) {
      this.logger.warn(
        { error: parsed.error },
        'ordinanceFlowContext: artifact parse failed; degrading to null',
      )
      return null
    }
    return parsed.data
  }
}
