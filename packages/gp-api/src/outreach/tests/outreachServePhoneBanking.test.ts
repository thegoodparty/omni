import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SERVE_PHONE_BANKING_PURPOSE_VALUES } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { LlmService } from '@/llm/services/llm.service'
import { ElectedOffice } from '../../generated/prisma'
import { SERVE_PHONE_BANKING_VOICE } from '../services/outreachPhoneBankingGeneration.service'
import { TONE_STYLES } from '../util/messageTone.util'

const service = useTestService()

const jsonCompletion = vi.fn()

let eoOrgSlug: string
let electedOffice: ElectedOffice

beforeEach(async () => {
  const llmSvc = service.app.get(LlmService)
  vi.spyOn(llmSvc, 'jsonCompletion').mockImplementation(jsonCompletion)

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  eoOrgSlug = `eo-${suffix}`

  await service.prisma.organization.create({
    data: { slug: eoOrgSlug, ownerId: service.user.id },
  })

  electedOffice = await service.prisma.electedOffice.create({
    data: { userId: service.user.id, organizationSlug: eoOrgSlug },
  })
})

const eoHeaders = (slug = eoOrgSlug) => ({
  headers: { 'x-organization-slug': slug },
})

const mockDraft = (draft: string) =>
  jsonCompletion.mockResolvedValue({
    object: { draft },
    tokens: 50,
    inputTokens: 25,
    outputTokens: 25,
    model: 'claude-test',
  })

const postDraft = (body: object, headers = eoHeaders()) =>
  service.client.post('/v1/outreach/serve/phone-banking/draft', body, headers)

const promptsFor = (
  call: { messages: Array<{ role: string; content: string }> } | undefined,
) => ({
  systemPrompt: call?.messages.find((m) => m.role === 'system')?.content,
  userPrompt: call?.messages.find((m) => m.role === 'user')?.content,
})

const freshServePurposes = SERVE_PHONE_BANKING_PURPOSE_VALUES.filter(
  (purpose) => purpose !== 'custom',
)

describe('POST /v1/outreach/serve/phone-banking/draft', () => {
  it.each(freshServePurposes)(
    'drafts the %s purpose with the verbatim CSV prompt and no candidate/election framing',
    async (purpose) => {
      mockDraft('You: Hi, is this [voter name]? Voter: Yes, speaking.')

      const res = await postDraft({ purpose, tone: 'warm' })
      expect(res.status).toBe(HttpStatus.CREATED)

      const { systemPrompt, userPrompt } = promptsFor(
        jsonCompletion.mock.calls[0]?.[0],
      )

      expect(userPrompt).toContain(
        SERVE_PHONE_BANKING_VOICE.purposePrompts[purpose],
      )
      expect(userPrompt).toContain('Office held')
      expect(userPrompt).not.toContain('Office sought')
      expect(userPrompt).not.toContain('Election day:')
      expect(userPrompt).not.toContain('Primary election day:')
      expect(userPrompt).not.toContain('Early voting')

      expect(systemPrompt).toContain('elected official')
      expect(systemPrompt).not.toMatch(/candidate/i)
      expect(systemPrompt).not.toMatch(/\bvoters\b/i)
      expect(userPrompt).not.toMatch(/candidate/i)
      expect(userPrompt).not.toMatch(/\bvoters\b/i)
    },
  )

  it('carries the opener-token floor rule (literal [your name] and voter-name tokens) in the system prompt', async () => {
    mockDraft('You: Hi. Voter: Hello.')

    const res = await postDraft({ purpose: 'event', tone: 'warm' })
    expect(res.status).toBe(HttpStatus.CREATED)

    const { systemPrompt } = promptsFor(jsonCompletion.mock.calls[0]?.[0])
    expect(systemPrompt).toContain(SERVE_PHONE_BANKING_VOICE.openerRule)
    expect(systemPrompt).toContain('[your name]')
    expect(systemPrompt).toContain('[voter name]')
  })

  it('rejects a Win-only purpose slug without calling the LLM', async () => {
    const res = await postDraft({ purpose: 'persuade', tone: 'warm' })
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(jsonCompletion).not.toHaveBeenCalled()
  })

  it('404s for an organization with no elected office', async () => {
    const bareOrg = await service.prisma.organization.create({
      data: { slug: `eo-bare-${Date.now()}`, ownerId: service.user.id },
    })

    const res = await postDraft(
      { purpose: 'event', tone: 'warm' },
      eoHeaders(bareOrg.slug),
    )
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(jsonCompletion).not.toHaveBeenCalled()
  })

  it('400s custom without currentDraft, and improves with the adapt-with-scaffolding copy when provided', async () => {
    const noDraft = await postDraft({ purpose: 'custom', tone: 'warm' })
    expect(noDraft.status).toBe(HttpStatus.BAD_REQUEST)
    expect(jsonCompletion).not.toHaveBeenCalled()

    mockDraft('You: Adapted words. Voter: Sounds good.')
    const withDraft = await postDraft({
      purpose: 'custom',
      tone: 'warm',
      currentDraft: 'My own message about the new sidewalk funding.',
    })
    expect(withDraft.status).toBe(HttpStatus.CREATED)

    const { systemPrompt, userPrompt } = promptsFor(
      jsonCompletion.mock.calls[0]?.[0],
    )
    expect(userPrompt).toContain(
      SERVE_PHONE_BANKING_VOICE.purposePrompts.custom,
    )
    expect(userPrompt).toContain('Flag rather than silently alter')
    expect(userPrompt).toContain(
      'My own message about the new sidewalk funding.',
    )
    expect(systemPrompt).toContain('elected official')
    expect(systemPrompt).not.toMatch(/candidate/i)
  })

  it('improves every serve purpose (polish mode) via currentDraft', async () => {
    mockDraft('You: A polished version. Voter: Great, thanks.')

    const res = await postDraft({
      purpose: 'share-resource',
      tone: 'friendly',
      currentDraft: 'You: hi there. Voter: hi.',
    })
    expect(res.status).toBe(HttpStatus.CREATED)

    const { systemPrompt, userPrompt } = promptsFor(
      jsonCompletion.mock.calls[0]?.[0],
    )
    expect(systemPrompt).toBe(SERVE_PHONE_BANKING_VOICE.improveSystemPrompt)
    expect(userPrompt).toContain('You: hi there. Voter: hi.')
    expect(userPrompt).toContain('Polish the script.')
  })

  it('never grounds on election/campaign data (no buildDateContext, no buildCampaignContext)', async () => {
    const campaignsService = service.app.get(CampaignsService)
    const fetchSpy = vi.spyOn(campaignsService, 'fetchLiveRaceTargetMetrics')

    mockDraft('You: Hi. Voter: Hello.')

    const res = await postDraft({ purpose: 'community-input', tone: 'direct' })
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(fetchSpy).not.toHaveBeenCalled()

    const { userPrompt } = promptsFor(jsonCompletion.mock.calls[0]?.[0])
    expect(userPrompt).not.toContain('campaign')
  })

  it('maps an LLM failure to 502', async () => {
    jsonCompletion.mockRejectedValue(new Error('model unavailable'))

    const res = await postDraft({ purpose: 'explain-decision', tone: 'urgent' })
    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
  })
})

describe('Public Profile grounding (ENG-10982)', () => {
  it('includes the Public Profile blocks in the phone-banking draft prompt', async () => {
    mockDraft('You: Hi. Voter: Hello.')
    await service.prisma.personProfile.create({
      data: {
        personId: `person-${Date.now()}`,
        userId: electedOffice.userId,
        bioOverride: 'I have lived here for 20 years.',
        whyRunning: 'I want to make sure every neighbor has a voice.',
      },
    })

    const res = await postDraft({ purpose: 'introduce', tone: 'warm' })
    expect(res.status).toBe(HttpStatus.CREATED)

    const { userPrompt } = promptsFor(jsonCompletion.mock.calls[0]?.[0])
    expect(userPrompt).toContain(
      [
        "The official's bio, in their own words:",
        '"""',
        'I have lived here for 20 years.',
        '"""',
      ].join('\n'),
    )
    expect(userPrompt).toContain(
      [
        'Why they serve, in their own words:',
        '"""',
        'I want to make sure every neighbor has a voice.',
        '"""',
      ].join('\n'),
    )
  })

  it('degrades to the exact baseline prompt for an official with no PersonProfile row', async () => {
    mockDraft('You: Hi. Voter: Hello.')

    const res = await postDraft({ purpose: 'introduce', tone: 'warm' })
    expect(res.status).toBe(HttpStatus.CREATED)

    const { userPrompt } = promptsFor(jsonCompletion.mock.calls[0]?.[0])
    expect(userPrompt).toBe(
      [
        `${SERVE_PHONE_BANKING_VOICE.nameLabel}: Johnny Goodparty.`,
        `${SERVE_PHONE_BANKING_VOICE.officeLabel}: local office.`,
        SERVE_PHONE_BANKING_VOICE.purposePrompts.introduce,
        `Tone: ${TONE_STYLES.warm}`,
        'Write the call script.',
      ].join('\n'),
    )
  })
})
