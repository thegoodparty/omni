import { BadGatewayException, HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { LlmService } from '@/llm/services/llm.service'
import { CallhubNumbersService } from '@/vendors/callhub/services/callhubNumbers.service'
import { RobocallComplianceService } from '@/outreach/services/robocallCompliance.service'
import { Campaign } from '../../generated/prisma'

const service = useTestService()

const jsonCompletion = vi.fn()
const rentNumber = vi.fn()
const checkRecording = vi.fn()

let campaign: Campaign
let orgSlug: string

beforeEach(async () => {
  const llmSvc = service.app.get(LlmService)
  vi.spyOn(llmSvc, 'jsonCompletion').mockImplementation(jsonCompletion)
  const callhub = service.app.get(CallhubNumbersService)
  vi.spyOn(callhub, 'rentNumber').mockImplementation(rentNumber)
  const compliance = service.app.get(RobocallComplianceService)
  vi.spyOn(compliance, 'checkRecording').mockImplementation(checkRecording)

  const campaignId = 997
  orgSlug = `campaign-${campaignId}`

  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })

  campaign = await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'jane-doe',
      isPro: true,
      details: {
        state: 'TX',
        city: 'Georgetown',
        zip: '78634',
        normalizedOffice: 'City Council',
      },
      data: {},
      aiContent: {},
    },
  })
})

const orgHeaders = () => ({ headers: { 'x-organization-slug': orgSlug } })

const postDraft = (body: object) =>
  service.client.post('/v1/outreach/robocall/draft', body, orgHeaders())

const postNumber = () =>
  service.client.post('/v1/outreach/robocall/number', {}, orgHeaders())

const postCompliance = (body: object) =>
  service.client.post('/v1/outreach/robocall/compliance', body, orgHeaders())

const validCompliancePayload = {
  audioKey: 'robocall/997/clip.webm',
  contentType: 'audio/webm',
  callbackNumber: '+12025550147',
}

const mockDraft = (draft: string) =>
  jsonCompletion.mockResolvedValue({
    object: { draft },
    tokens: 50,
    inputTokens: 25,
    outputTokens: 25,
    model: 'claude-test',
  })

const userContent = () => {
  const call = jsonCompletion.mock.calls[0]?.[0]
  return call.messages.find((m: { role: string }) => m.role === 'user')
    ?.content as string
}

const systemContent = () => {
  const call = jsonCompletion.mock.calls[0]?.[0]
  return call.messages.find((m: { role: string }) => m.role === 'system')
    ?.content as string
}

describe('POST /v1/outreach/robocall/draft', () => {
  it('returns the generated script grounded in office and place', async () => {
    mockDraft('Hi, this is Jane Doe, and I am running for City Council.')

    const res = await postDraft({ purpose: 'introduce_myself', tone: 'warm' })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({
      draft: 'Hi, this is Jane Doe, and I am running for City Council.',
    })

    expect(jsonCompletion).toHaveBeenCalledTimes(1)
    const call = jsonCompletion.mock.calls[0]?.[0]
    expect(call.temperature).toBe(0.8)
    const userPrompt = userContent()
    expect(userPrompt).toContain('introduce the candidate to voters')
    expect(userPrompt).toContain('Warm:')
    expect(userPrompt).toContain('City Council')
    expect(userPrompt).toContain(
      'Where the candidate is running: Georgetown, TX.',
    )
  })

  it('feeds campaign story and issues into the prompt', async () => {
    await service.prisma.campaignStory.create({
      data: {
        campaignId: campaign.id,
        background: 'I grew up here and coach little league on weekends.',
      },
    })
    await service.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        details: {
          ...campaign.details,
          customIssues: [
            { title: 'Housing', position: 'Build more affordable units' },
          ],
        },
      },
    })

    mockDraft('A grounded script.')

    const res = await postDraft({ purpose: 'introduce_myself', tone: 'warm' })
    expect(res.status).toBe(HttpStatus.CREATED)

    const userPrompt = userContent()
    expect(userPrompt).toContain(
      'I grew up here and coach little league on weekends.',
    )
    expect(userPrompt).toContain('Housing: Build more affordable units')
  })

  it('requires the candidate self-ID opener and bans compliance lines', async () => {
    mockDraft('A script.')

    const res = await postDraft({ purpose: 'introduce_myself', tone: 'warm' })
    expect(res.status).toBe(HttpStatus.CREATED)

    const systemPrompt = systemContent()
    expect(systemPrompt).toContain('Hi, this is')
    expect(systemPrompt).toContain('and I am running for')
    expect(systemPrompt).toContain('"Paid for by"')
    expect(systemPrompt).toContain('callback phone number')
    expect(systemPrompt).toContain('"Reply STOP"')
  })

  it('requires the spoken disclosure when a callbackNumber is given', async () => {
    mockDraft('A script that ends with the disclosure.')

    const res = await postDraft({
      purpose: 'introduce_myself',
      tone: 'warm',
      callbackNumber: '+12025550147',
    })
    expect(res.status).toBe(HttpStatus.CREATED)

    const systemPrompt = systemContent()
    expect(systemPrompt).toContain('say the callback number given below')
    // The ban rule must NOT apply once a number is provided.
    expect(systemPrompt).not.toContain('Do NOT include a "Paid for by" line')

    const userPrompt = userContent()
    expect(userPrompt).toContain('Callback number to read aloud: +12025550147')
    expect(userPrompt).toContain('"Paid for by" name:')
  })

  it('requires the disclosure on the improve path too', async () => {
    mockDraft('A polished script that still ends with the disclosure.')

    const res = await postDraft({
      purpose: 'introduce_myself',
      tone: 'warm',
      currentDraft: 'Hi, this is Jane, running for council.',
      callbackNumber: '+12025550147',
    })
    expect(res.status).toBe(HttpStatus.CREATED)

    expect(systemContent()).toContain('END with the spoken disclosure')
    expect(userContent()).toContain(
      'Callback number to read aloud: +12025550147',
    )
  })

  it.each(['early_voting', 'election_day_turnout'])(
    'includes voting logistics placeholders for %s',
    async (purpose) => {
      mockDraft('A script.')

      const res = await postDraft({ purpose, tone: 'urgent' })
      expect(res.status).toBe(HttpStatus.CREATED)

      expect(userContent()).toContain('voting logistics as bracketed')
    },
  )

  it('polishes the given text when currentDraft is present', async () => {
    mockDraft('A clearer version of my own words.')

    const res = await postDraft({
      purpose: 'introduce_myself',
      tone: 'direct',
      currentDraft: 'Hi, this is Jane, running for council.',
    })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({ draft: 'A clearer version of my own words.' })

    expect(systemContent()).toContain('polish')
    expect(systemContent()).toContain(
      'Every concrete detail in the original MUST appear in your output',
    )
    const userPrompt = userContent()
    expect(userPrompt).toContain('Hi, this is Jane, running for council.')
    expect(userPrompt).toContain('Polish the script.')
    expect(userPrompt).not.toContain('Write the robocall script.')
  })

  it('allows improve mode for the custom purpose', async () => {
    mockDraft('Polished custom words.')

    const res = await postDraft({
      purpose: 'custom',
      tone: 'warm',
      currentDraft: 'Entirely my words, roughly phrased.',
    })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({ draft: 'Polished custom words.' })
  })

  it('rejects fresh generation for the custom purpose without the LLM', async () => {
    const res = await postDraft({ purpose: 'custom', tone: 'warm' })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(jsonCompletion).not.toHaveBeenCalled()
  })

  it('rejects invalid input without calling the LLM', async () => {
    const badTone = await postDraft({
      purpose: 'persuade_voters',
      tone: 'sarcastic',
    })
    expect(badTone.status).toBe(HttpStatus.BAD_REQUEST)

    const badPurpose = await postDraft({
      purpose: 'world_domination',
      tone: 'warm',
    })
    expect(badPurpose.status).toBe(HttpStatus.BAD_REQUEST)

    expect(jsonCompletion).not.toHaveBeenCalled()
  })

  it('maps an LLM failure to 502', async () => {
    jsonCompletion.mockRejectedValue(new Error('model unavailable'))

    const res = await postDraft({ purpose: 'persuade_voters', tone: 'urgent' })

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
  })

  it('rejects a non-Pro campaign with a 400', async () => {
    await service.prisma.campaign.update({
      where: { id: campaign.id },
      data: { isPro: false },
    })

    const res = await postDraft({ purpose: 'introduce_myself', tone: 'warm' })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(jsonCompletion).not.toHaveBeenCalled()
  })
})

describe('POST /v1/outreach/robocall/number', () => {
  it('rents a US caller-ID number and returns it', async () => {
    rentNumber.mockResolvedValue({
      phone_number: '+12025550147',
      region: 'DC',
      is_active: true,
    })

    const res = await postNumber()

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({ phoneNumber: '+12025550147', region: 'DC' })
    expect(rentNumber).toHaveBeenCalledWith({ countryIso: 'US' })
  })

  it('rejects a non-Pro campaign without renting', async () => {
    await service.prisma.campaign.update({
      where: { id: campaign.id },
      data: { isPro: false },
    })

    const res = await postNumber()

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(rentNumber).not.toHaveBeenCalled()
  })

  it('propagates a CallHub rental failure as a 502', async () => {
    // The vendor service maps a CallHub failure to BadGateway; the controller
    // must not swallow or remap it.
    rentNumber.mockRejectedValue(new BadGatewayException('rental failed'))

    const res = await postNumber()

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
  })
})

describe('POST /v1/outreach/robocall/compliance', () => {
  it('checks the recording and returns a passing verdict', async () => {
    checkRecording.mockResolvedValue({
      passed: true,
      checks: {
        hasSelfIdentification: true,
        hasOrganization: true,
        hasCallbackNumber: true,
      },
      transcript: 'Hi, this is Jane Doe...',
      issues: [],
    })

    const res = await postCompliance(validCompliancePayload)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.passed).toBe(true)
    // Candidate + organization are derived server-side; the client only sends
    // the key, content type, and callback number.
    const args = checkRecording.mock.calls[0]?.[0]
    expect(args).toMatchObject({
      audioKey: 'robocall/997/clip.webm',
      contentType: 'audio/webm',
      callbackNumber: '+12025550147',
    })
    expect(args.organizationName).toContain('City Council')
  })

  it('returns a failing verdict with the issues', async () => {
    checkRecording.mockResolvedValue({
      passed: false,
      checks: {
        hasSelfIdentification: true,
        hasOrganization: false,
        hasCallbackNumber: false,
      },
      transcript: 'Hi, this is Jane.',
      issues: ['Name the organization.', 'State the callback number.'],
    })

    const res = await postCompliance(validCompliancePayload)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.passed).toBe(false)
    expect(res.data.issues).toHaveLength(2)
  })

  it('rejects an audio key from another campaign without checking', async () => {
    const res = await postCompliance({
      ...validCompliancePayload,
      audioKey: 'robocall/998/someone-elses.webm',
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(checkRecording).not.toHaveBeenCalled()
  })

  it('rejects a non-Pro campaign without checking', async () => {
    await service.prisma.campaign.update({
      where: { id: campaign.id },
      data: { isPro: false },
    })

    const res = await postCompliance(validCompliancePayload)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(checkRecording).not.toHaveBeenCalled()
  })

  it('propagates a fail-closed compliance failure as a 502', async () => {
    // A transcription/LLM failure surfaces from the service as BadGateway; the
    // controller must not swallow it into a silent pass.
    checkRecording.mockRejectedValue(new BadGatewayException('transcribe down'))

    const res = await postCompliance(validCompliancePayload)

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
  })
})
