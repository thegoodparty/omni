import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps, ReactElement } from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import CreateListFlow from './CreateListFlow'
import type { PolygonRing } from '../VoterMapCanvas'
import { DoorKnockingSurfaceProvider } from '../doorKnockingSurface'

// Each line is a TokenField: its text lives in the editor TipTap hangs on
// the textbox, not in a `value`.
const lineEditor = (label: string) =>
  (screen.getByLabelText(label) as HTMLElement & { editor: Editor }).editor
const lineText = (label: string) =>
  lineEditor(label).getText({ blockSeparator: '\n' })
const setLine = (label: string, text: string) =>
  act(() => {
    lineEditor(label).commands.setContent(text)
  })

// The create flow mounts milestone 2's in-flow gate, whose membership read
// reaches for the organization provider this file does not stand up. Ungated
// here; the gate's own behavior is covered in CreateListFlow.test.tsx.
vi.mock('app/dashboard/outreach/v2/gate/useOutreachGate', () => ({
  useOutreachGate: () => ({
    enabled: false,
    requirement: null,
    twoStep: false,
    membership: null,
    tcrCompliance: null,
  }),
}))

// The question-asking card is offered only where issue capture is on; these
// cases pick it, so the flag is on here.
vi.mock('app/shared/experiments/issueCaptureFlag', () => ({
  useIssueCaptureFlag: () => ({ ready: true, enabled: true }),
}))

const useCampaignMock = vi.fn()
const useUserMock = vi.fn()

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => useCampaignMock(),
}))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => useUserMock(),
}))

// Dictation reaches for getUserMedia, which jsdom has not got. The mic is not
// what any of these assert.
vi.mock('app/dashboard/shared/dictation/useDictationAppend', () => ({
  useDictationAppend: () => ({
    status: 'idle',
    error: null,
    busy: false,
    toggle: vi.fn(),
  }),
}))

const OPEN_RING: PolygonRing = [
  [-87.66, 41.92],
  [-87.65, 41.92],
  [-87.65, 41.93],
]

const baseProps = {
  filters: {},
  onFiltersChange: vi.fn(),
  precincts: [],
  onPrecinctsChange: vi.fn(),
  precinctOptions: {
    options: [],
    truncated: false,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  onStepChange: vi.fn(),
  onClose: vi.fn(),
  source: 'outreach_page' as const,
  districtBounds: null as [[number, number], [number, number]] | null,
  districtHouseholds: 1500,
  districtHouseholdsPending: false,
  districtHouseholdsFailed: false,
  districtUnavailable: false,
  audienceEmpty: false,
  savedLists: [],
  allContactsHouseholds: 12000,
  ring: OPEN_RING,

  drawPointCount: 3,
  drawFullScreen: false,
  onDrawFullScreenChange: vi.fn(),
  mapChromeBottomPx: 16,
  onRestartDrawing: vi.fn(),
  color: '#2563eb',
  drawnStops: null,
  onStartKnocking: vi.fn(),
  isServeOrg: false,
  unpreviewableKeys: [],
  orgSlug: 'campaign-9',
  addressPreview: null,
  previewPending: false,
  previewFailed: false,
  previewStale: false,
  onShowAddresses: vi.fn(),
  onHideAddresses: vi.fn(),
  onRetryAddresses: vi.fn(),
  // One turf, so the route step's Build route is live. These tests are
  // about the card, not the campaign, so the draft is the minimum that
  // gets them past the draw step.
  turfDrafts: [
    {
      clientId: 'draft-1',
      polygon: OPEN_RING,
      color: '#2563eb',
      name: 'Turf 1',
      assigneeId: null,
    },
  ],
  draftStats: new Map(),
  activeDraftId: null as string | null,
  onSelectDraft: vi.fn(),
  onStartNewTurf: vi.fn(),
  onRemoveDraft: vi.fn(),
  onUpdateDraft: vi.fn(),
  onPickColor: vi.fn(),
}

const POINTS = {
  engagementQuestion: 'What would you fix around here first?',
  context: 'Fix our roads with a real maintenance plan, not patchwork.',
  ask: 'Ask whether we can count on them in November.',
}

// Every draft request the flow made, in order.
type DraftBody = Record<string, unknown>
let drafts: DraftBody[] = []
let serveDrafts: DraftBody[] = []

const mockDraft = (overrides: Partial<typeof POINTS> = {}): void => {
  api.mock('POST /v1/outreach/door-knocking/draft', ({ body }) => {
    drafts.push(body)
    return { status: 200, data: { ...POINTS, ...overrides } }
  })
  api.mock('POST /v1/outreach/serve/door-knocking/draft', ({ body }) => {
    serveDrafts.push(body)
    return { status: 200, data: { ...POINTS, ...overrides } }
  })
}

// A model failure. The endpoint answers 502, which the mock helper's status
// union does not carry — and nothing here can tell the two apart, since the
// step branches on `isError` alone. Same 500 the social flow's draft-failure
// tests use for the same reason.
const mockDraftFailure = (): void => {
  api.mock('POST /v1/outreach/door-knocking/draft', {
    status: 500,
    data: POINTS,
  })
}

// The candidate's own walk to the card: pick a goal, take the audience as it
// stands, name the list, and arrive. The rerenders are the page's `step` prop
// catching up with the advance the flow asked for, exactly as in the sibling
// suite.
const renderAtPoints = async (
  props: Partial<ComponentProps<typeof CreateListFlow>> = {},
  goal = /Turn out my supporters/,
) => {
  const view = render(
    <CreateListFlow {...baseProps} {...props} step="filters" />,
  )
  fireEvent.click(screen.getByRole('button', { name: goal }))
  view.rerender(<CreateListFlow {...baseProps} {...props} step="name" />)
  fireEvent.change(screen.getByLabelText('Campaign name'), {
    target: { value: 'Westside turnout' },
  })
  view.rerender(<CreateListFlow {...baseProps} {...props} step="points" />)
  await waitFor(() => expect(lineText('Context')).toBe(POINTS.context))
  return view
}

const rerenderWith = (
  view: { rerender: (ui: ReactElement) => void },
  props: Partial<ComponentProps<typeof CreateListFlow>>,
  step: 'points' | 'draw',
) => view.rerender(<CreateListFlow {...baseProps} {...props} step={step} />)

beforeEach(() => {
  testQueryClient.clear()
  vi.clearAllMocks()
  drafts = []
  serveDrafts = []
  useCampaignMock.mockReturnValue([
    {
      id: 9,
      positionName: 'City Council',
      details: { website: 'https://janedoe.org' },
    },
  ])
  useUserMock.mockReturnValue([{ firstName: 'Jane', lastName: 'Doe' }])
})

describe('the talking points step', () => {
  it('drafts on arrival, with the list’s purpose and audience', async () => {
    mockDraft()

    await renderAtPoints({ filters: { homeownerYes: true } })

    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      purpose: 'election_day_turnout',
      filters: expect.objectContaining({ homeownerYes: true }),
    })
    // Neither draft field on a first generation: there is nothing to polish
    // and nothing to diverge from.
    expect(drafts[0]).not.toHaveProperty('currentDraft')
    expect(drafts[0]).not.toHaveProperty('previousDraft')
  })

  // The audience sent here is narrower than the one being walked, on purpose.
  // `describeFilterForTalkingPoints` reads an allowlist of life-circumstance
  // dimensions and discards the targeting mechanics, so sending precincts or
  // a support status would only hand the endpoint keys it throws away. The
  // pills are the part that survives, and a picked saved list carries its
  // pills in `filters` like any other audience.
  it('sends the pills and not the targeting mechanics', async () => {
    mockDraft()

    await renderAtPoints({
      filters: { homeownerYes: true, veteranYes: true },
    })

    // Asserted through the draft rather than off the index, so the absence
    // checks below cannot pass by reading `undefined`.
    expect(drafts).toHaveLength(1)
    const sent = drafts[0]?.filters
    expect(sent).toMatchObject({ homeownerYes: true, veteranYes: true })
    expect(sent).not.toHaveProperty('precincts')
    expect(sent).not.toHaveProperty('supportStatus')
    expect(sent).not.toHaveProperty('activityConditions')
  })

  it('shows the three generated lines in their own boxes', async () => {
    mockDraft()

    await renderAtPoints()

    expect(lineText('Opening question')).toBe(POINTS.engagementQuestion)
    expect(lineText('Context')).toBe(POINTS.context)
    expect(lineText('The ask')).toBe(POINTS.ask)
  })

  // The two composed sections are shown so the candidate reviews the whole
  // card rather than the four lines they can edit — and are not fields,
  // because neither is theirs to change here.
  it('previews the introduction and the close without making them editable', async () => {
    mockDraft()

    await renderAtPoints()

    expect(
      screen.getByText("Hi, I'm Jane Doe, running for City Council."),
    ).toBeInTheDocument()
    expect(screen.getByText(/Thank them for their time/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Introduction')).toBeNull()
    expect(screen.queryByLabelText('Thanks and goodbye')).toBeNull()
  })

  // The call to action is the one editable line the model never writes: the URL
  // is real data, and the prompt bans links outright.
  it('composes the call to action from the campaign website', async () => {
    mockDraft()

    await renderAtPoints()

    expect(lineText('Call to action')).toBe(
      'Point them to janedoe.org to learn more — no commitment needed.',
    )
  })

  it('leaves the call to action blank when there is no website on file', async () => {
    mockDraft()
    useCampaignMock.mockReturnValue([{ id: 9, details: {} }])

    await renderAtPoints()

    expect(lineText('Call to action')).toBe('')
  })

  describe('regenerate and improve', () => {
    it('tells the model what was rejected on a regenerate', async () => {
      mockDraft()

      await renderAtPoints()
      fireEvent.click(screen.getByRole('button', { name: /Regenerate/ }))

      await waitFor(() => expect(drafts).toHaveLength(2))
      // The three generated lines, in card order — never the composed call to
      // action, which is not the model's to rewrite.
      expect(drafts[1]?.previousDraft).toBe(
        [POINTS.engagementQuestion, POINTS.context, POINTS.ask].join('\n'),
      )
      expect(drafts[1]).not.toHaveProperty('currentDraft')
    })

    it('sends the candidate’s edits as the draft to polish', async () => {
      mockDraft()

      await renderAtPoints()
      setLine('Context', 'Roads are bad.')
      fireEvent.click(screen.getByRole('button', { name: /Improve with AI/ }))

      await waitFor(() => expect(drafts).toHaveLength(2))
      expect(drafts[1]?.currentDraft).toContain('Roads are bad.')
      expect(drafts[1]).not.toHaveProperty('previousDraft')
    })

    it('passes the candidate’s instructions along and trims them', async () => {
      mockDraft()

      await renderAtPoints()
      fireEvent.change(screen.getByLabelText('Instructions for the AI'), {
        target: { value: '  Lead with the library.  ' },
      })
      fireEvent.click(screen.getByRole('button', { name: /Regenerate/ }))

      await waitFor(() => expect(drafts).toHaveLength(2))
      expect(drafts[1]?.instructions).toBe('Lead with the library.')
    })

    it('omits blank instructions rather than sending an empty string', async () => {
      mockDraft()

      await renderAtPoints()
      fireEvent.change(screen.getByLabelText('Instructions for the AI'), {
        target: { value: '   ' },
      })
      fireEvent.click(screen.getByRole('button', { name: /Regenerate/ }))

      await waitFor(() => expect(drafts).toHaveLength(2))
      expect(drafts[1]).not.toHaveProperty('instructions')
    })
  })

  // "Something else" means the candidate is writing their own. The endpoint
  // refuses a fresh generation for it with a 400, so the flow must not spend
  // the call — and must not offer Regenerate, which is the press that would.
  describe('the custom purpose', () => {
    it('drafts nothing and offers no regenerate', async () => {
      mockDraft()

      const view = render(<CreateListFlow {...baseProps} step="filters" />)
      fireEvent.click(screen.getByRole('button', { name: /Something else/ }))
      view.rerender(<CreateListFlow {...baseProps} step="name" />)
      fireEvent.change(screen.getByLabelText('Campaign name'), {
        target: { value: 'My own walk' },
      })
      view.rerender(<CreateListFlow {...baseProps} step="points" />)

      expect(drafts).toHaveLength(0)
      expect(screen.queryByRole('button', { name: /Regenerate/ })).toBeNull()
      // Nothing written yet, so there is nothing to improve either.
      expect(
        screen.queryByRole('button', { name: /Improve with AI/ }),
      ).toBeNull()

      setLine('Context', 'Roads.')
      fireEvent.click(screen.getByRole('button', { name: /Improve with AI/ }))
      await waitFor(() => expect(drafts).toHaveLength(1))
      expect(drafts[0]?.currentDraft).toBe('Roads.')
    })
  })

  // A model failure must not stand between the candidate and the route they
  // came to buy, so the step offers a retry and the CTA stays live.
  it('offers a retry on failure without blocking the walk', async () => {
    mockDraftFailure()

    const view = render(<CreateListFlow {...baseProps} step="filters" />)
    fireEvent.click(
      screen.getByRole('button', { name: /Turn out my supporters/ }),
    )
    view.rerender(<CreateListFlow {...baseProps} step="name" />)
    fireEvent.change(screen.getByLabelText('Campaign name'), {
      target: { value: 'Westside turnout' },
    })
    view.rerender(<CreateListFlow {...baseProps} step="points" />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled(),
    )
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  // The slow-model case, which is the common one: these drafts take seconds.
  // Phone banking holds its CTA until the draft lands because its script is
  // required; here the card is optional, so waiting on the model would be
  // holding the candidate back from the route for nothing.
  it('lets the walk go on while the model is still writing', async () => {
    // A model that has not answered yet: nothing resolves this draft.
    api.mock(
      'POST /v1/outreach/door-knocking/draft',
      () => new Promise<never>(() => undefined),
    )

    const view = render(<CreateListFlow {...baseProps} step="filters" />)
    fireEvent.click(
      screen.getByRole('button', { name: /Turn out my supporters/ }),
    )
    view.rerender(<CreateListFlow {...baseProps} step="name" />)
    fireEvent.change(screen.getByLabelText('Campaign name'), {
      target: { value: 'Westside turnout' },
    })
    view.rerender(<CreateListFlow {...baseProps} step="points" />)

    await screen.findByLabelText('Context')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('warns about an unfilled logistics bracket', async () => {
    mockDraft({ ask: 'Invite them to the town hall on [date].' })

    await renderAtPoints({}, /Invite people to an event/)

    expect(screen.getByText(/Fill in the square brackets/)).toBeInTheDocument()
  })

  // The question the official typed is what the effort exists to ask, so the
  // card's ask has to be written from it. Without this the ask came back as
  // the purpose copy's generic "what should the council focus on".
  it('sends the community-input question to the serve endpoint', async () => {
    mockDraft()
    const question = 'Would you take part in a compost pilot?'
    const serveSurface = (step: 'filters' | 'name' | 'points') => (
      <DoorKnockingSurfaceProvider value>
        <CreateListFlow {...baseProps} step={step} />
      </DoorKnockingSurfaceProvider>
    )

    const view = render(serveSurface('filters'))
    fireEvent.click(
      screen.getByRole('button', { name: /Ask for community input/ }),
    )
    fireEvent.change(await screen.findByLabelText('The question'), {
      target: { value: question },
    })
    view.rerender(serveSurface('name'))
    fireEvent.change(screen.getByLabelText('Campaign name'), {
      target: { value: 'Ward 3 listening' },
    })
    view.rerender(serveSurface('points'))

    await waitFor(() => expect(serveDrafts).toHaveLength(1))
    expect(serveDrafts[0]).toMatchObject({
      purpose: 'community_input',
      communityInputQuestion: question,
    })
  })

  // Win's "Hear from voters" asks one question too, and its card is written
  // from it by the Win prompt, never the Serve one.
  it('sends the hear-from-voters question to the win endpoint', async () => {
    mockDraft()
    const question = 'How do you feel about the road bond?'

    const view = render(<CreateListFlow {...baseProps} step="filters" />)
    fireEvent.click(screen.getByRole('button', { name: /Hear from voters/ }))
    fireEvent.change(await screen.findByLabelText('The question'), {
      target: { value: question },
    })
    view.rerender(<CreateListFlow {...baseProps} step="name" />)
    fireEvent.change(screen.getByLabelText('Campaign name'), {
      target: { value: 'Road bond listening' },
    })
    view.rerender(<CreateListFlow {...baseProps} step="points" />)

    await waitFor(() => expect(drafts).toHaveLength(1))
    expect(drafts[0]).toMatchObject({
      purpose: 'community_input',
      communityInputQuestion: question,
    })
    expect(serveDrafts).toHaveLength(0)
  })

  // Every other purpose asks nothing, so it must not carry a stale question
  // into a request its endpoint would only ignore.
  it('sends no question for a purpose that asks none', async () => {
    mockDraft()
    const serveSurface = (step: 'filters' | 'name' | 'points') => (
      <DoorKnockingSurfaceProvider value>
        <CreateListFlow {...baseProps} step={step} />
      </DoorKnockingSurfaceProvider>
    )

    const view = render(serveSurface('filters'))
    fireEvent.click(
      screen.getByRole('button', { name: /Explain a recent decision/ }),
    )
    view.rerender(serveSurface('name'))
    fireEvent.change(screen.getByLabelText('Campaign name'), {
      target: { value: 'Ward 3 update' },
    })
    view.rerender(serveSurface('points'))

    await waitFor(() => expect(serveDrafts).toHaveLength(1))
    expect(serveDrafts[0]).not.toHaveProperty('communityInputQuestion')
  })

  // Serve is the same step and the same route, discriminated by the surface
  // context — and its card must never be written by the prompt that says
  // "running for".
  it('asks the serve endpoint on the serve surface', async () => {
    mockDraft()
    const serveSurface = (step: 'filters' | 'name' | 'points') => (
      <DoorKnockingSurfaceProvider value>
        <CreateListFlow {...baseProps} step={step} />
      </DoorKnockingSurfaceProvider>
    )

    const view = render(serveSurface('filters'))
    fireEvent.click(
      screen.getByRole('button', { name: /Ask for community input/ }),
    )
    view.rerender(serveSurface('name'))
    fireEvent.change(screen.getByLabelText('Campaign name'), {
      target: { value: 'Ward 3 listening' },
    })
    view.rerender(serveSurface('points'))

    await waitFor(() => expect(serveDrafts).toHaveLength(1))
    expect(serveDrafts[0]).toMatchObject({ purpose: 'community_input' })
    // Never the Win endpoint, whose prompt says "running for".
    expect(drafts).toHaveLength(0)
  })
})

describe('freezing the card with the list', () => {
  const mockCreate = (): { bodies: Record<string, unknown>[] } => {
    const bodies: Record<string, unknown>[] = []
    api.mock('POST /v1/voters/voter-file/filter', {
      status: 200,
      data: { id: 77 },
    })
    api.mock('POST /v1/door-knocking/turfs', ({ body }) => {
      bodies.push(body as Record<string, unknown>)
      return {
        status: 200,
        data: {
          id: 5,
          outreachId: 900,
          voterFileFilterId: 77,
          name: 'Westside turnout',
          color: '#2563eb',
          geoPoly: {
            type: 'Polygon' as const,
            coordinates: [[...OPEN_RING, OPEN_RING[0] as [number, number]]],
          },
          stopCount: 9,
          doorCount: 9,
          peopleCount: 22,
          loggedCount: 0,
          knockedDoorCount: 0,
          routeSeconds: 1860,
          completed: false,
          archivedAt: null,
          createdAt: new Date('2026-08-20T00:00:00Z'),
          updatedAt: new Date('2026-08-20T00:00:00Z'),
        },
      }
    })
    return { bodies }
  }

  // The four card lines, newline-separated in card order, on the same body
  // that buys the route — so the card is frozen in the one transaction that
  // writes the walk, and the purpose it was written for is stored beside it.
  it('sends the purpose and the four lines on the create body', async () => {
    mockDraft()
    const { bodies } = mockCreate()
    const props = { onStepChange: vi.fn() }

    const view = await renderAtPoints(props)
    rerenderWith(view, props, 'draw')
    fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({
      purpose: 'election_day_turnout',
      talkingPoints: [
        POINTS.engagementQuestion,
        POINTS.context,
        'Point them to janedoe.org to learn more — no commitment needed.',
        POINTS.ask,
      ].join('\n'),
    })
  })

  // A candidate who skipped past a failed draft still gets their route. An
  // empty card is no card, not four newlines for the door to try to parse.
  it('omits the points entirely when nothing was written', async () => {
    mockDraftFailure()
    useCampaignMock.mockReturnValue([{ id: 9, details: {} }])
    const { bodies } = mockCreate()
    const props = { onStepChange: vi.fn() }

    const view = render(
      <CreateListFlow {...baseProps} {...props} step="filters" />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: /Turn out my supporters/ }),
    )
    view.rerender(<CreateListFlow {...baseProps} {...props} step="name" />)
    fireEvent.change(screen.getByLabelText('Campaign name'), {
      target: { value: 'Westside turnout' },
    })
    rerenderWith(view, props, 'points')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled(),
    )
    rerenderWith(view, props, 'draw')
    fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).not.toHaveProperty('talkingPoints')
    expect(bodies[0]).toMatchObject({ purpose: 'election_day_turnout' })
  })

  // The same skip, for a campaign that HAS a website — which is most of them.
  // The call to action is seeded from the campaign record before the draft is
  // even requested, so counting it as content would freeze a card whose only
  // line is the URL. At the door that is worse than no card: the stored card
  // suppresses the issue stances, so the walk would lose the stances and gain
  // a website.
  it('freezes no card when only the composed call to action is filled', async () => {
    mockDraftFailure()
    const { bodies } = mockCreate()
    const props = { onStepChange: vi.fn() }

    const view = render(
      <CreateListFlow {...baseProps} {...props} step="filters" />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: /Turn out my supporters/ }),
    )
    view.rerender(<CreateListFlow {...baseProps} {...props} step="name" />)
    fireEvent.change(screen.getByLabelText('Campaign name'), {
      target: { value: 'Westside turnout' },
    })
    rerenderWith(view, props, 'points')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled(),
    )
    // The seeded line is really there — this is the state the guard has to
    // recognise, not an absent one.
    expect(lineText('Call to action')).toBe(
      'Point them to janedoe.org to learn more — no commitment needed.',
    )

    rerenderWith(view, props, 'draw')
    fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).not.toHaveProperty('talkingPoints')
  })

  // The four boxes are textareas, so a Return or a pasted paragraph is a
  // newline in a format whose delimiter is the newline. A five-line card is
  // rejected whole by `parseTalkingPoints`, silently, at every door — so the
  // collapse happens on the way in.
  it('collapses an edited line that a candidate typed a return into', async () => {
    mockDraft()
    const { bodies } = mockCreate()
    const props = { onStepChange: vi.fn() }

    const view = await renderAtPoints(props)
    setLine('Context', 'Fix the roads.\nAnd the sidewalks.')
    rerenderWith(view, props, 'draw')
    fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    const stored = bodies[0]?.talkingPoints as string
    expect(stored.split('\n')).toHaveLength(4)
    expect(stored.split('\n')[1]).toBe('Fix the roads. And the sidewalks.')
  })

  // The boxes are read-only while the first draft is written — the composed
  // call to action lands in state before that request is made, and counting
  // it as drafted content would leave the boxes open with a generation about
  // to overwrite whatever was typed into them.
  it('keeps the boxes read-only while the first draft is being written', async () => {
    api.mock(
      'POST /v1/outreach/door-knocking/draft',
      () => new Promise<never>(() => undefined),
    )

    const view = render(<CreateListFlow {...baseProps} step="filters" />)
    fireEvent.click(
      screen.getByRole('button', { name: /Turn out my supporters/ }),
    )
    view.rerender(<CreateListFlow {...baseProps} step="name" />)
    fireEvent.change(screen.getByLabelText('Campaign name'), {
      target: { value: 'Westside turnout' },
    })
    view.rerender(<CreateListFlow {...baseProps} step="points" />)

    await waitFor(() =>
      expect(screen.getByLabelText('Context')).toHaveAttribute(
        'aria-readonly',
        'true',
      ),
    )
  })

  // One heading, not two. The flow renders every stage's title and caption
  // from `STAGE_META`, so a step that renders its own stacks a second pair.
  it('is headed once, by the flow', async () => {
    mockDraft()

    await renderAtPoints()

    // The stage's own title and caption, once. (The drawer's `sr-only` title
    // repeats the stage title by design, so the caption is what counts here.)
    expect(screen.queryByText('Your talking points')).toBeNull()
    expect(screen.getAllByText(/Notes for this list/)).toHaveLength(1)
  })

  // Changing the purpose over an edited card leaves a re-draft nominally
  // owed. Every successful draft clears the manual-edit flag, so the next
  // Regenerate would land its result and be overwritten a moment later by a
  // fresh draft nobody asked for.
  it('does not chase a Regenerate with a second draft', async () => {
    mockDraft()
    const props = { onStepChange: vi.fn() }

    const view = await renderAtPoints(props)
    setLine('Context', 'My own words.')
    // Back to the goal cards, pick a different one, and return to a card they
    // have already made theirs. `purpose`, `who` and `filters` are three
    // stages of one page step, so how many Backs that takes depends on which
    // face the step was left on.
    view.rerender(<CreateListFlow {...baseProps} {...props} step="filters" />)
    while (
      screen.queryByRole('button', { name: /Introduce myself/ }) === null
    ) {
      fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    }
    fireEvent.click(screen.getByRole('button', { name: /Introduce myself/ }))
    rerenderWith(view, props, 'points')
    await waitFor(() => expect(lineText('Context')).toBe('My own words.'))
    expect(drafts).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /Regenerate/ }))

    await waitFor(() => expect(drafts).toHaveLength(2))
    // The regenerate and nothing after it.
    await waitFor(() => expect(lineText('Context')).toBe(POINTS.context))
    expect(drafts).toHaveLength(2)
  })
})

describe('an event invite', () => {
  const fill = (date: string, time: string, location: string) => {
    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: date },
    })
    fireEvent.change(screen.getByLabelText('Start time'), {
      target: { value: time },
    })
    fireEvent.change(screen.getByLabelText('Location'), {
      target: { value: location },
    })
  }

  const detailsHeading = () =>
    screen.getByRole('heading', {
      level: 3,
      name: 'When and where is the event?',
    })

  it('asks when and where before the audience, and drafts the points with it', async () => {
    mockDraft()
    const onStepChange = vi.fn()
    const view = render(
      <CreateListFlow
        {...baseProps}
        onStepChange={onStepChange}
        step="filters"
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: /Invite people to an event/ }),
    )
    expect(detailsHeading()).toBeInTheDocument()
    const continueButton = () =>
      screen.getByRole('button', { name: 'Continue' })
    expect(continueButton()).toBeDisabled()

    fill('2099-03-14', '14:00', 'Westside rec center')
    expect(continueButton()).toBeEnabled()
    fireEvent.click(continueButton())
    expect(
      screen.getByRole('heading', {
        level: 3,
        name: 'Who do you want to reach?',
      }),
    ).toBeInTheDocument()
    expect(onStepChange).not.toHaveBeenCalled()

    view.rerender(<CreateListFlow {...baseProps} step="points" />)
    await waitFor(() => expect(drafts).toHaveLength(1))
    expect(drafts[0]).toMatchObject({
      purpose: 'event_invite',
      event: {
        date: '2099-03-14',
        time: '14:00',
        location: 'Westside rec center',
      },
    })
  })

  it('walks back to the details with what was entered', () => {
    render(<CreateListFlow {...baseProps} step="filters" />)

    fireEvent.click(
      screen.getByRole('button', { name: /Invite people to an event/ }),
    )
    fill('2099-03-14', '14:00', 'Westside rec center')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(detailsHeading()).toBeInTheDocument()
    expect(screen.getByLabelText('Location')).toHaveValue('Westside rec center')
  })
})
