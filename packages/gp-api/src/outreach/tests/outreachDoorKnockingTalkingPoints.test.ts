import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { LlmService } from '@/llm/services/llm.service'
import { Campaign } from '../../generated/prisma'

const service = useTestService()

const jsonCompletion = vi.fn()

let campaign: Campaign
let orgSlug: string

beforeEach(async () => {
  const llmSvc = service.app.get(LlmService)
  vi.spyOn(llmSvc, 'jsonCompletion').mockImplementation(jsonCompletion)

  const campaignId = 997
  orgSlug = `campaign-${campaignId}`

  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })

  campaign = await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'jane-doe-dk',
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
  service.client.post('/v1/outreach/door-knocking/draft', body, orgHeaders())

const POINTS = {
  engagementQuestion: 'What is the one thing you would fix around here?',
  context: 'Fix our roads with a real maintenance plan, not patchwork.',
  ask: 'Ask whether we can count on them in November.',
}

const mockPoints = (points: Partial<typeof POINTS> = {}) =>
  jsonCompletion.mockResolvedValue({
    object: { ...POINTS, ...points },
    tokens: 50,
    inputTokens: 25,
    outputTokens: 25,
    model: 'claude-test',
  })

const promptOf = (role: 'system' | 'user'): string => {
  const call = jsonCompletion.mock.calls[0]?.[0] as {
    messages: { role: string; content: string }[]
  }
  return call.messages.find((m) => m.role === role)?.content ?? ''
}

const draftBody = (overrides: object = {}) => ({
  purpose: 'introduce_myself',
  filters: {},
  ...overrides,
})

describe('POST /v1/outreach/door-knocking/draft', () => {
  it('returns the three generated lines, named', async () => {
    mockPoints()

    const res = await postDraft(draftBody())

    expect(res.status).toBe(HttpStatus.CREATED)
    // Named fields rather than one blob: the model cannot merge or reorder
    // the sections, and each is separately assertable.
    expect(res.data).toEqual(POINTS)
  })

  it('grounds the prompt in the office and the campaign materials', async () => {
    await service.prisma.campaignStory.create({
      data: {
        campaignId: campaign.id,
        background: 'I grew up here and coach little league on weekends.',
      },
    })
    mockPoints()

    await postDraft(draftBody())

    const user = promptOf('user')
    expect(user).toContain('City Council')
    expect(user).toContain('Where the candidate is running: Georgetown, TX.')
    expect(user).toContain('coach little league on weekends')
  })

  // **The issue store current onboarding actually writes to.**
  // `details.customIssues` belongs to the legacy /dashboard/questions flow,
  // which has no nav entry; onboarding calls `saveAboutFields({ issues })`
  // and lands the candidate's issues on the website instead. Door knocking is
  // the one caller that passes `includeWebsiteIssues`, because the Context
  // section is worth nothing without issue material — the other four channels
  // deliberately still read one store, so this feature changes none of them.
  describe('the issue stores', () => {
    it('feeds the issues onboarding wrote to the website into the prompt', async () => {
      await service.prisma.website.create({
        data: {
          campaignId: campaign.id,
          vanityPath: `issues-${Date.now()}`,
          content: {
            about: {
              issues: [
                {
                  title: 'Transit',
                  // Quill writes HTML here, which is why this store cannot be
                  // read straight into a prompt: the markup would spend
                  // context and can drift into the generated text.
                  description:
                    '<p>Restore the <strong>crosstown bus</strong>.</p>',
                },
              ],
            },
          },
        },
      })
      mockPoints()

      await postDraft(draftBody())

      const user = promptOf('user')
      expect(user).toContain('Transit: Restore the crosstown bus.')
      expect(user).not.toContain('<strong>')
    })

    // A candidate who entered the same issue in both editors should have it
    // stated once. Twice reads to the model as emphasis nobody asked for.
    it('states an issue held in both stores only once', async () => {
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
      await service.prisma.website.create({
        data: {
          campaignId: campaign.id,
          vanityPath: `dupe-${Date.now()}`,
          content: {
            about: {
              // Cased differently on purpose — the dedupe is on the lowercased
              // title, the same rule the door script applies to these two
              // stores.
              issues: [{ title: 'housing', description: 'Something else.' }],
            },
          },
        },
      })
      mockPoints()

      await postDraft(draftBody())

      const user = promptOf('user')
      expect(user).toContain('Housing: Build more affordable units')
      expect(user).not.toContain('Something else.')
    })
  })

  // The rule the other channels' prompts would get exactly backwards. Phone
  // banking and SMS produce text a person reads out; this produces notes a
  // person reads FROM, and every other rule depends on that framing landing.
  it('tells the model these are notes, not dialogue', () => {
    mockPoints()

    return postDraft(draftBody()).then(() => {
      const system = promptOf('system')
      expect(system).toContain('BULLET NOTES')
      expect(system).toContain('Do not write')
      expect(system).toContain('never lines to recite')
    })
  })

  // The single highest-leverage sentence in the prompt. A note that compresses
  // to "Roads" has told the canvasser nothing and pushes them into improvising
  // at a door, which is where false claims come from.
  it('demands the concrete how rather than the topic', async () => {
    mockPoints()

    await postDraft(draftBody())

    expect(promptOf('system')).toContain('Name the concrete HOW')
  })

  // The model is told the shape of the whole card so its three lines sit
  // inside a conversation it can see — and told which two are not its to
  // write, which is what keeps a URL out of the call-to-action.
  it('states the five-section card and which lines are the app’s', async () => {
    mockPoints()

    await postDraft(draftBody())

    const system = promptOf('system')
    expect(system).toContain('five-section card')
    expect(system).toContain('the app writes this from the campaign record')
    expect(system).toContain('Never write a URL')
  })

  describe('the audience block', () => {
    // The product requirement: the list's filters must reach the points. The
    // block frames them as a selection over the candidate's own priorities,
    // never as a fact about whoever opens the door.
    it('describes an allowed filter and forbids asserting it', async () => {
      mockPoints()

      await postDraft(
        draftBody({ filters: { homeownerYes: true, age65Plus: true } }),
      )

      const user = promptOf('user')
      expect(user).toContain('The audience this list selects:')
      expect(user).toContain('Homeownership Homeowner')
      expect(user).toContain('Age 65+')
      expect(user).toContain("which of the candidate's existing priorities")
      expect(user).toContain('NOT a fact about the person who answers the door')
    })

    // Provenance rides with the description because most of these values are
    // vendor estimates, and the model has to hedge accordingly.
    it('carries the provenance rules with it', async () => {
      mockPoints()

      await postDraft(draftBody({ filters: { homeownerYes: true } }))

      expect(promptOf('user')).toContain('DIMENSION PROVENANCE')
    })

    // Every compose prompt in this product ends with "Stay strictly
    // non-partisan. No party labels, no attacks." Passing the party in would
    // hand the model that label and the rule forbidding it in one breath. The
    // allowlist keeps it out of the prompt entirely rather than relying on the
    // rule to hold.
    it('never lets the party reach the prompt', async () => {
      mockPoints()

      await postDraft(
        draftBody({ filters: { partyDemocrat: true, age65Plus: true } }),
      )

      const user = promptOf('user')
      expect(user).toContain('Age 65+')
      expect(user).not.toContain('Democrat')
      expect(user).not.toContain('Political Party')
    })

    // Null, not "no filters applied": a list cut only by party has plenty of
    // filters and nothing this feature may say about them. Telling the model
    // it is unfiltered would be a lie it then writes around.
    it('omits the block entirely when nothing survives the allowlist', async () => {
      mockPoints()

      await postDraft(draftBody({ filters: { partyDemocrat: true } }))

      const user = promptOf('user')
      expect(user).not.toContain('The audience this list selects:')
      expect(user).not.toContain('no filters applied')
    })

    it('omits the block for an unfiltered list', async () => {
      mockPoints()

      await postDraft(draftBody({ filters: {} }))

      expect(promptOf('user')).not.toContain('The audience this list selects:')
    })
  })

  describe('purpose', () => {
    it('steers the ask', async () => {
      mockPoints()

      await postDraft(draftBody({ purpose: 'election_day_turnout' }))

      expect(promptOf('user')).toContain(
        'The ask is a commitment to vote on election day',
      )
    })

    // The shape of a door ask is not a per-purpose question, so it is stated
    // once for all of them. Two requests in one line is the failure this
    // guards: "vote early and take a yard sign" gets a nod and neither.
    it('holds every purpose to one request', async () => {
      mockPoints()

      await postDraft(draftBody())

      expect(promptOf('system')).toContain('ONE request and no more')
    })

    // The one line allowed to carry brackets, and only because event
    // logistics are not modelled anywhere in this product.
    it('permits logistics brackets only for an event invite', async () => {
      mockPoints()

      await postDraft(draftBody({ purpose: 'event_invite' }))

      expect(promptOf('user')).toContain('[date]')
      expect(promptOf('system')).toContain(
        'Use a bracketed placeholder ONLY in the ask',
      )
    })

    // Fresh generation only. Improve mode polishes the author's own words, so
    // it applies to custom-purpose points too — the refusal is specifically
    // about writing custom points from nothing.
    it('refuses to write custom points from scratch', async () => {
      mockPoints()

      const res = await service.client.post(
        '/v1/outreach/door-knocking/draft',
        draftBody({ purpose: 'custom' }),
        { ...orgHeaders(), validateStatus: () => true },
      )

      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
      expect(jsonCompletion).not.toHaveBeenCalled()
    })

    it('adapts custom points the candidate wrote', async () => {
      mockPoints()

      const res = await postDraft(
        draftBody({ purpose: 'custom', currentDraft: 'Roads are bad.' }),
      )

      expect(res.status).toBe(HttpStatus.CREATED)
      expect(promptOf('user')).toContain('Roads are bad.')
    })
  })

  describe('improve and regenerate', () => {
    it('polishes an existing draft rather than writing fresh', async () => {
      mockPoints()

      await postDraft(draftBody({ currentDraft: 'Roads. Vote. Thanks.' }))

      expect(promptOf('user')).toContain(
        'The existing talking points to polish:',
      )
      expect(promptOf('system')).toContain(
        'This is a light edit, NOT a rewrite',
      )
    })

    // Regenerate: the rejected draft rides along so the re-roll varies rather
    // than converging on what the candidate just turned down.
    it('tells the model what was rejected on a re-roll', async () => {
      mockPoints()

      await postDraft(draftBody({ previousDraft: 'Roads. Vote. Thanks.' }))

      const user = promptOf('user')
      expect(user).toContain('just rejected')
      expect(user).toContain('a different engagement question')
      expect(promptOf('system')).not.toContain('light edit')
    })

    // The two paths are mutually exclusive by construction — the service picks
    // improve off currentDraft alone, so a previousDraft beside it would be
    // silently dropped. Reject rather than accept and ignore.
    it('rejects both drafts at once', async () => {
      const res = await service.client.post(
        '/v1/outreach/door-knocking/draft',
        draftBody({ currentDraft: 'a', previousDraft: 'b' }),
        { ...orgHeaders(), validateStatus: () => true },
      )

      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    })
  })

  it('applies the candidate’s own instructions', async () => {
    mockPoints()

    await postDraft(draftBody({ instructions: 'Lead with the library.' }))

    expect(promptOf('user')).toContain('Lead with the library.')
  })

  // A trim-then-min(1) without the schema's transform would 400 on whitespace
  // even though the field is optional, and the client cannot tell that from a
  // real schema error.
  it('treats whitespace-only instructions as absent', async () => {
    mockPoints()

    const res = await postDraft(draftBody({ instructions: '   ' }))

    expect(res.status).toBe(HttpStatus.CREATED)
  })

  // A recoverable over-budget line must not become an unrecoverable 502, so
  // the schema the model is validated against carries no .max() and the trim
  // enforces the contract's cap instead.
  it('trims an over-long line at a sentence boundary', async () => {
    const long = `${'Fix the roads with a real plan. '.repeat(20)}End.`
    mockPoints({ context: long })

    const res = await postDraft(draftBody())

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.context.length).toBeLessThanOrEqual(400)
    expect(res.data.context.endsWith('.')).toBe(true)
  })

  // The wizard stores the card's four lines newline-separated, so a wrapped
  // line or a model-supplied bullet marker would split one section into two at
  // the door.
  it('flattens a wrapped line and strips a bullet marker', async () => {
    mockPoints({ context: '- Fix the roads\n  with a real plan.' })

    const res = await postDraft(draftBody())

    expect(res.data.context).toBe('Fix the roads with a real plan.')
  })

  it('502s when the model call fails', async () => {
    jsonCompletion.mockRejectedValue(new Error('boom'))

    const res = await service.client.post(
      '/v1/outreach/door-knocking/draft',
      draftBody(),
      { ...orgHeaders(), validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
  })
})
