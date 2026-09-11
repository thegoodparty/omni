import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SERVE_OUTREACH_PURPOSE_VALUES } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { LlmService } from '@/llm/services/llm.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { SERVE_DOOR_KNOCKING_VOICE } from '../services/outreachDoorKnockingGeneration.service'

const service = useTestService()

const jsonCompletion = vi.fn()

let eoOrgSlug: string

// Office name and place live behind the election API, not on ElectedOffice, so
// the controller resolves them best-effort. Stub the resolution rather than
// seeding rows: the assertions here are about what reaches the prompt.
beforeEach(async () => {
  const llmSvc = service.app.get(LlmService)
  vi.spyOn(llmSvc, 'jsonCompletion').mockImplementation(jsonCompletion)

  const orgs = service.app.get(OrganizationsService)
  vi.spyOn(orgs, 'resolvePositionNameByOrganizationSlug').mockResolvedValue(
    'City Council',
  )
  vi.spyOn(orgs, 'getDistrictForOrgSlug').mockResolvedValue({
    l2Name: 'City of Georgetown',
    state: 'TX',
  } as Awaited<ReturnType<OrganizationsService['getDistrictForOrgSlug']>>)

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  eoOrgSlug = `eo-${suffix}`

  await service.prisma.organization.create({
    data: { slug: eoOrgSlug, ownerId: service.user.id },
  })

  await service.prisma.electedOffice.create({
    data: { userId: service.user.id, organizationSlug: eoOrgSlug },
  })
})

const eoHeaders = () => ({ headers: { 'x-organization-slug': eoOrgSlug } })

const POINTS = {
  engagementQuestion: 'What is working and not working on your street?',
  context: 'The office is tracking road repairs district by district.',
  ask: 'Ask what they want raised at the next council meeting.',
}

const mockPoints = () =>
  jsonCompletion.mockResolvedValue({
    object: POINTS,
    tokens: 50,
    inputTokens: 25,
    outputTokens: 25,
    model: 'claude-test',
  })

const postDraft = (body: object) =>
  service.client.post(
    '/v1/outreach/serve/door-knocking/draft',
    body,
    eoHeaders(),
  )

const promptOf = (role: 'system' | 'user'): string => {
  const call = jsonCompletion.mock.calls[0]?.[0] as {
    messages: { role: string; content: string }[]
  }
  return call.messages.find((m) => m.role === role)?.content ?? ''
}

const draftBody = (overrides: object = {}) => ({
  purpose: 'community_input',
  filters: {},
  ...overrides,
})

const freshPurposes = SERVE_OUTREACH_PURPOSE_VALUES.filter(
  (purpose) => purpose !== 'custom',
)

describe('POST /v1/outreach/serve/door-knocking/draft', () => {
  it.each(freshPurposes)('drafts the %s purpose', async (purpose) => {
    mockPoints()

    const res = await postDraft(draftBody({ purpose }))

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(promptOf('user')).toContain(
      SERVE_DOOR_KNOCKING_VOICE.purposePrompts[purpose],
    )
  })

  // The whole point of a separate Serve rail: this person already holds the
  // office, so nothing may frame the walk as a campaign or an election.
  it('frames the walk as constituent service, never a campaign', async () => {
    mockPoints()

    await postDraft(draftBody())

    const system = promptOf('system')
    expect(system).toContain('already holds this office')
    expect(system).not.toMatch(/\brunning for\b/)
    expect(system).not.toMatch(/\bcampaign\b/i)
    expect(system).not.toMatch(/\bvote\b/i)
  })

  it('grounds the prompt in the office actually held', async () => {
    mockPoints()

    await postDraft(draftBody())

    const user = promptOf('user')
    expect(user).toContain('City Council')
    expect(user).toContain('Where the elected official serves: Georgetown, TX.')
  })

  // Serve's card differs from Win's in two sections, so the shape the model is
  // handed has to differ too — an "ask them to vote" note would be wrong here.
  it('states the Serve card shape', async () => {
    mockPoints()

    await postDraft(draftBody())

    const system = promptOf('system')
    expect(system).toContain('five-section card')
    expect(system).toContain('"Hi, I\'m {name}, your {office}."')
    expect(system).toContain('to ask of the constituent')
  })

  // The Win rail's filter allowlist is not the Serve rail's: voter-file
  // targeting dimensions have no place in constituent service.
  it('keeps voter targeting dimensions out of the audience block', async () => {
    mockPoints()

    await postDraft(
      draftBody({ filters: { partyDemocrat: true, homeownerYes: true } }),
    )

    const user = promptOf('user')
    expect(user).toContain('Homeownership Homeowner')
    expect(user).not.toContain('Democrat')
  })

  it('refuses to write custom points from scratch', async () => {
    mockPoints()

    const res = await service.client.post(
      '/v1/outreach/serve/door-knocking/draft',
      draftBody({ purpose: 'custom' }),
      { ...eoHeaders(), validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(jsonCompletion).not.toHaveBeenCalled()
  })
})
