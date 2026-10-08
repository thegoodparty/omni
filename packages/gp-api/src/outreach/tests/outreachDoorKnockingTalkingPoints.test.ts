import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DOOR_KNOCKING_BULLET,
  DOOR_KNOCKING_TALKING_POINTS_MAX_LENGTH,
} from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { LlmService } from '@/llm/services/llm.service'
import { Campaign } from '../../generated/prisma'
import { WIN_DOOR_KNOCKING_VOICE } from '../services/outreachDoorKnockingGeneration.service'

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

const POINTS = [
  'Ask what one thing they would fix around here.',
  'Fix our roads with a real maintenance plan, not patchwork.',
  'Keep the library open on weekends.',
  'Ask whether we can count on them in November.',
]

const completion = (object: object) =>
  jsonCompletion.mockResolvedValue({
    object,
    tokens: 50,
    inputTokens: 25,
    outputTokens: 25,
    model: 'claude-test',
  })

const mockPoints = (points: string[] = POINTS) => completion({ points })

const mockPolish = (draft: string) => completion({ draft })

const asBullets = (points: string[]) =>
  points.map((point) => `${DOOR_KNOCKING_BULLET}${point}`).join('\n')

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

// The lines `withField` adds to `without`, asserting that adding them is the
// ONLY difference — so a request without the field is byte-identical to one
// that never knew the field existed.
const addedLines = (without: string, withField: string): string[] => {
  const before = without.split('\n')
  const after = withField.split('\n')
  let start = 0
  while (start < before.length && before[start] === after[start]) start++
  const count = after.length - before.length
  expect(after.slice(start + count)).toEqual(before.slice(start))
  return after.slice(start, start + count)
}

describe('POST /v1/outreach/door-knocking/draft', () => {
  // "Hear from voters" asks one question, and the card's ask is written from
  // it the way Serve's community-input card is.
  describe('the hear-from-voters question', () => {
    const question = 'How do you feel about the road bond?'

    it('adds the fenced question and its precedence, and nothing else', async () => {
      mockPoints()
      await postDraft(draftBody({ purpose: 'community_input' }))
      const baseline = { system: promptOf('system'), user: promptOf('user') }

      jsonCompletion.mockClear()
      mockPoints()
      const res = await postDraft(
        draftBody({
          purpose: 'community_input',
          communityInputQuestion: question,
        }),
      )

      expect(res.status).toBe(HttpStatus.CREATED)
      expect(promptOf('system')).toBe(baseline.system)
      expect(addedLines(baseline.user, promptOf('user'))).toEqual([
        'The question this effort is trying to answer:',
        '"""',
        question,
        '"""',
        expect.stringContaining(
          'in place of the general question described above',
        ),
      ])
    })

    it('drafts the purpose in Win’s own voice', async () => {
      mockPoints()

      await postDraft(
        draftBody({
          purpose: 'community_input',
          communityInputQuestion: question,
        }),
      )

      expect(promptOf('user')).toContain(
        WIN_DOOR_KNOCKING_VOICE.purposePrompts.community_input,
      )
      expect(`${promptOf('system')}${promptOf('user')}`).not.toMatch(
        /constituent/i,
      )
    })

    // One-way, as on Serve: a question folded into any other purpose's ask
    // writes a card about something the effort is not about.
    it('refuses a question on a purpose that asks none', async () => {
      const res = await postDraft(
        draftBody({
          purpose: 'persuade_voters',
          communityInputQuestion: question,
        }),
      )

      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
      expect(jsonCompletion).not.toHaveBeenCalled()
    })
  })

  it('returns the bullets as one draft, each line marked', async () => {
    mockPoints()

    const res = await postDraft(draftBody())

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.draft).toBe(asBullets(POINTS))
  })

  // A tab open across the deploy still reads the three sections it used to
  // edit: first line, the middle lines, last line, markers stripped.
  it('fills the legacy sections from the draft for one release', async () => {
    mockPoints()

    const res = await postDraft(draftBody())

    expect(res.data).toMatchObject({
      engagementQuestion: POINTS[0],
      context: `${POINTS[1]} ${POINTS[2]}`,
      ask: POINTS[3],
    })
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
      expect(system).toContain('Do not write dialogue')
      expect(system).toContain('never lines to recite')
    })
  })

  it('asks for 4 or 5 bullets, one action each, about the goal', async () => {
    mockPoints()

    await postDraft(draftBody())

    const system = promptOf('system')
    expect(system).toContain('Write 4 or 5 short bullets')
    expect(system).toContain('ONE action or idea')
    expect(system).toContain(
      'about what the campaign is working toward or asking for',
    )
    expect(system).toContain('never about the person who answers the door')
    expect(system).toContain('No em dashes')
    expect(system).toContain('sentence case')
    // The model imitates its prompt.
    expect(system).not.toContain('\u2014')
  })

  // The single highest-leverage sentence in the prompt. A note that compresses
  // to "Roads" has told the canvasser nothing and pushes them into improvising
  // at a door, which is where false claims come from.
  it('demands the concrete how rather than the topic', async () => {
    mockPoints()

    await postDraft(draftBody())

    expect(promptOf('system')).toContain('Name the concrete HOW')
  })

  // Nothing is composed around the card any more, so the bullets carry the
  // opening and the close, and a volunteer reads the same card the candidate
  // does.
  it('opens and closes the card in the third person', async () => {
    mockPoints()

    await postDraft(draftBody())

    const system = promptOf('system')
    expect(system).toContain('The first bullet is how to open')
    expect(system).toContain('the last is how to close')
    expect(system).toContain('never a scripted greeting or goodbye')
    expect(system).toContain('in the third person')
    expect(system).not.toContain("Hi, I'm")
    expect(system).toContain('Never write a URL')
    expect(system).not.toMatch(/call.to.action/i)
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

    it('writes an event invite from the details the flow sent', async () => {
      mockPoints()

      await postDraft(
        draftBody({
          purpose: 'event_invite',
          event: {
            date: '2026-10-17',
            time: '18:30',
            location: 'Georgetown Public Library',
          },
        }),
      )

      const user = promptOf('user')
      expect(user).toContain('Date: Saturday, October 17')
      expect(user).toContain('Time: 6:30 PM')
      expect(user).toContain('Location: Georgetown Public Library')
      expect(`${promptOf('system')}\n${user}`).not.toMatch(
        /\[(date|time|location)\]/i,
      )
    })

    it('leaves the logistics out of an event invite sent without details', async () => {
      mockPoints()

      await postDraft(draftBody({ purpose: 'event_invite' }))

      const user = promptOf('user')
      expect(user).toContain('No event date, time or place was given.')
      expect(promptOf('system')).toContain(
        'Never write a bracketed placeholder.',
      )
      expect(`${promptOf('system')}\n${user}`).not.toMatch(
        /\[(date|time|location)\]/i,
      )
    })

    it('rejects event details it cannot write in', async () => {
      const res = await service.client.post(
        '/v1/outreach/door-knocking/draft',
        draftBody({
          purpose: 'event_invite',
          event: { date: 'Saturday', time: '6pm', location: 'Library' },
        }),
        { ...orgHeaders(), validateStatus: () => true },
      )

      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
      expect(jsonCompletion).not.toHaveBeenCalled()
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
      mockPolish('Roads are bad.')

      const res = await postDraft(
        draftBody({ purpose: 'custom', currentDraft: 'Roads are bad.' }),
      )

      expect(res.status).toBe(HttpStatus.CREATED)
      expect(promptOf('user')).toContain('Roads are bad.')
    })
  })

  describe('improve and regenerate', () => {
    it('polishes an existing draft rather than writing fresh', async () => {
      mockPolish('Fix the roads. Vote in November.')

      const res = await postDraft(
        draftBody({ currentDraft: 'Roads. Vote. Thanks.' }),
      )

      expect(promptOf('user')).toContain(
        'The existing talking points to polish:',
      )
      expect(promptOf('system')).toContain(
        'This is a light edit, NOT a rewrite',
      )
      expect(res.data.draft).toBe('Fix the roads. Vote in November.')
    })

    // Free text is the candidate's: an Improve never turns sentences into
    // bullets or bullets into sentences.
    it('keeps the shape the candidate wrote', async () => {
      const bullets = asBullets(['Fix the roads.', 'Ask for their vote.'])
      mockPolish(bullets)

      const res = await postDraft(draftBody({ currentDraft: bullets }))

      const system = promptOf('system')
      expect(system).toContain('Keep the shape they wrote')
      expect(system).toContain('Never turn one into')
      expect(system).toContain('Keep their line breaks')
      expect(system).not.toContain('Write 4 or 5 short bullets')
      expect(res.data.draft).toBe(bullets)
      expect(res.data).toMatchObject({
        engagementQuestion: 'Fix the roads.',
        context: '',
        ask: 'Ask for their vote.',
      })
    })

    it('trims an over-long polish at a line, not mid-word', async () => {
      const line = 'Fix the roads with a real plan and no patchwork'
      const long = Array.from({ length: 60 }, () => line).join('\n')
      mockPolish(long)

      const res = await postDraft(draftBody({ currentDraft: 'Roads.' }))

      expect(res.status).toBe(HttpStatus.CREATED)
      const draft: string = res.data.draft
      expect(draft.length).toBeLessThanOrEqual(
        DOOR_KNOCKING_TALKING_POINTS_MAX_LENGTH,
      )
      expect(draft.split('\n').every((l) => l === line)).toBe(true)
    })

    // Regenerate: the rejected draft rides along so the re-roll varies rather
    // than converging on what the candidate just turned down.
    it('tells the model what was rejected on a re-roll', async () => {
      mockPoints()

      await postDraft(draftBody({ previousDraft: 'Roads. Vote. Thanks.' }))

      const user = promptOf('user')
      expect(user).toContain('just rejected')
      expect(user).toContain('a different angle')
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

  // A recoverable over-budget bullet must not become an unrecoverable 502, so
  // the schema the model is validated against carries no .max() and the trim
  // enforces the budget instead.
  it('trims an over-long bullet at a sentence boundary', async () => {
    const long = `${'Fix the roads with a real plan. '.repeat(20)}End.`
    mockPoints([long, ...POINTS.slice(1)])

    const res = await postDraft(draftBody())

    expect(res.status).toBe(HttpStatus.CREATED)
    const first: string = res.data.draft.split('\n')[0]
    expect(first.startsWith(DOOR_KNOCKING_BULLET)).toBe(true)
    expect(first.length).toBeLessThanOrEqual(DOOR_KNOCKING_BULLET.length + 200)
    expect(first.endsWith('.')).toBe(true)
  })

  // The draft is the bullets newline-separated, so a wrapped bullet or a
  // model-supplied marker would split one bullet into two or print twice.
  it('flattens a wrapped bullet and strips any marker the model added', async () => {
    mockPoints([
      '- Fix the roads\n  with a real plan.',
      '• Keep the library open.',
      '3. Ask about the bus line.',
      'Ask for their vote.',
    ])

    const res = await postDraft(draftBody())

    expect(res.data.draft).toBe(
      asBullets([
        'Fix the roads with a real plan.',
        'Keep the library open.',
        'Ask about the bus line.',
        'Ask for their vote.',
      ]),
    )
  })

  // The prompt asks for 4 or 5, but a reply with another count is still a
  // draft the candidate edits, so it is kept rather than failed.
  it.each([
    [7, 5],
    [3, 3],
  ])('keeps a reply of %i bullets as %i', async (given, kept) => {
    mockPoints(
      Array.from({ length: given }, (_, i) => `Talk about point ${i + 1}.`),
    )

    const res = await postDraft(draftBody())

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.draft.split('\n')).toHaveLength(kept)
  })

  // A reply that is only markers or whitespace is nothing to put on the
  // card, so it fails like a failed call rather than storing a blank draft.
  it.each([
    {
      name: 'every bullet is only a marker',
      mock: () => mockPoints(['-', '•', '   ']),
      body: {},
    },
    {
      name: 'a polish comes back blank',
      mock: () => mockPolish('   '),
      body: { currentDraft: 'Fix the roads.' },
    },
  ])('502s when $name', async ({ mock, body }) => {
    mock()

    const res = await service.client.post(
      '/v1/outreach/door-knocking/draft',
      draftBody(body),
      { ...orgHeaders(), validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
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
