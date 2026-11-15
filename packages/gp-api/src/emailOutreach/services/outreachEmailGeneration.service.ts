import { BadGatewayException, Injectable } from '@nestjs/common'
import {
  EMAIL_HEADING_MAX_LENGTH,
  EMAIL_LAYOUT_PRESETS,
  EmailAiDraftFieldsSchema,
  type EmailAiDraftRequest,
  type EmailAiDraftResponse,
} from '@goodparty_org/contracts'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { AnalyticsService } from '@/analytics/analytics.service'
import { ownerCandidateName } from '@/campaigns/util/ownerCandidateName.util'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { LlmService } from '@/llm/services/llm.service'
import { type LlmMessage } from '@/llm/types/llmMessages.types'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { OutreachComposeContextService } from '@/outreach/services/outreachComposeContext.service'
import { OutreachServeComposeContextService } from '@/outreach/services/outreachServeComposeContext.service'
import { TONE_STYLES } from '@/outreach/services/outreachSmsGeneration.service'
import { getUserFullName } from '@/users/util/users.util'
import { EVENTS } from '@/vendors/segment/segment.types'
import { ElectedOffice, User } from '../../generated/prisma'
import { fieldsToBlocks, presetForLayout } from '../util/emailContent.util'
import {
  EmailVoiceConfig,
  SERVE_EMAIL_VOICE,
  WIN_EMAIL_VOICE,
} from '../util/emailVoice.util'

// A fresh draft always has a title, short enough for the Title field.
// Improve keeps the author's choice, so it may still return null.
const FreshDraftFieldsSchema = EmailAiDraftFieldsSchema.extend({
  headline: z.string().trim().min(1).max(EMAIL_HEADING_MAX_LENGTH),
})

@Injectable()
export class OutreachEmailGenerationService {
  constructor(
    private readonly llm: LlmService,
    private readonly organizations: OrganizationsService,
    private readonly winContext: OutreachComposeContextService,
    private readonly serveContext: OutreachServeComposeContextService,
    private readonly analytics: AnalyticsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachEmailGenerationService.name)
  }

  async draftForCampaign(
    campaign: CampaignWith<'user'>,
    user: User,
    input: EmailAiDraftRequest,
  ): Promise<EmailAiDraftResponse> {
    const office =
      (await this.resolvePositionName(campaign.organizationSlug)) ??
      campaign.details.normalizedOffice ??
      ''
    return this.generate(
      input,
      ownerCandidateName(campaign),
      office,
      user.id,
      [
        ...(campaign.details.website
          ? [`The campaign's website: ${campaign.details.website}`]
          : []),
        ...(await this.winContext.buildCampaignContext(campaign)),
      ],
      WIN_EMAIL_VOICE,
      'win',
    )
  }

  async draftForOffice(
    electedOffice: ElectedOffice,
    user: User,
    input: EmailAiDraftRequest,
  ): Promise<EmailAiDraftResponse> {
    const office =
      (await this.resolvePositionName(electedOffice.organizationSlug)) ?? ''
    return this.generate(
      input,
      getUserFullName(user),
      office,
      user.id,
      await this.serveContext.buildProfileContext(electedOffice.userId),
      SERVE_EMAIL_VOICE,
      'serve',
    )
  }

  // The office name is prompt enrichment only, so an election-api failure
  // must not fail the draft.
  private async resolvePositionName(
    organizationSlug: string,
  ): Promise<string | null> {
    try {
      return await this.organizations.resolvePositionNameByOrganizationSlug(
        organizationSlug,
      )
    } catch (err) {
      this.logger.warn({ err }, 'position resolution failed for email draft')
      return null
    }
  }

  private async generate(
    input: EmailAiDraftRequest,
    name: string,
    office: string,
    userId: number,
    composeContext: string[],
    voice: EmailVoiceConfig,
    mode: 'win' | 'serve',
  ): Promise<EmailAiDraftResponse> {
    const preset = presetForLayout(input.layout)
    const layout = EMAIL_LAYOUT_PRESETS[preset]
    const context = [
      `${voice.nameLabel}: ${name || voice.subjectFallback}.`,
      `${voice.officeLabel}: ${office || 'local office'}.`,
      `Goal of this email: ${input.goal}`,
      `Tone: ${TONE_STYLES[input.tone]}`,
      `Layout: ${layout.label}. ${layout.description}`,
      ...composeContext,
    ]
    const messages: LlmMessage[] = input.currentDraft
      ? [
          { role: 'system', content: voice.improveSystemPrompt },
          {
            role: 'user',
            content: [
              ...context,
              `${voice.subjectFallback}'s email to polish, as JSON:`,
              '"""',
              JSON.stringify(input.currentDraft),
              '"""',
              'Polish the email.',
            ].join('\n'),
          },
        ]
      : [
          { role: 'system', content: voice.draftSystemPrompt },
          {
            role: 'user',
            content: [...context, 'Write the email.'].join('\n'),
          },
        ]
    let draft: EmailAiDraftResponse
    try {
      const { object } = await this.llm.jsonCompletion({
        messages,
        schema: input.currentDraft
          ? EmailAiDraftFieldsSchema
          : FreshDraftFieldsSchema,
        // High enough that Regenerate re-rolls produce a different draft.
        temperature: 0.8,
        maxTokens: 1500,
        userId: String(userId),
      })
      draft = {
        ...object,
        content: {
          layout: preset,
          theme: input.theme ?? layout.defaultTheme,
          subject: object.subject,
          // The headline is the form's Title (the first level 1 heading) in
          // every layout, so it never goes through fieldsToBlocks, which
          // makes a personal letter's headline a paragraph.
          blocks: [
            ...(object.headline
              ? [
                  {
                    type: 'heading' as const,
                    text: object.headline,
                    level: 1 as const,
                  },
                ]
              : []),
            ...fieldsToBlocks(preset, {
              headline: null,
              body: object.body,
              imageUrl: null,
              buttonLabel: object.buttonLabel,
              buttonUrl: null,
            }),
          ],
        },
      }
    } catch (err) {
      this.logger.error({ err }, 'email draft generation failed')
      throw new BadGatewayException('Email draft generation failed')
    }
    await this.trackDraftCompleted(userId, {
      mode,
      layout: input.layout,
      tone: input.tone,
      improved: input.currentDraft !== undefined,
    })
    return draft
  }

  private async trackDraftCompleted(
    userId: number,
    properties: {
      mode: 'win' | 'serve'
      layout: string
      tone: string
      improved: boolean
    },
  ): Promise<void> {
    try {
      await this.analytics.track(
        userId,
        EVENTS.Email.DraftCompleted,
        properties,
      )
    } catch (err) {
      this.logger.error({ err }, 'email draft analytics failed')
    }
  }
}
