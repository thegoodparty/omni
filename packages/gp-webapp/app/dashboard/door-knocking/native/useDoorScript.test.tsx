import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { type ReactNode } from 'react'
import type { Campaign, User } from 'helpers/types'

const clientRequestMock = vi.fn()
const useCampaignMock = vi.fn()
const useUserMock = vi.fn()
const useDoorKnockingServeModeMock = vi.fn()
const useDoorKnockingOfficeNameMock = vi.fn()
const useDoorKnockingCanvasserMock = vi.fn()

vi.mock('gpApi/typed-request', () => ({
  clientRequest: (...args: unknown[]) => clientRequestMock(...args),
}))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => useCampaignMock(),
}))

vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => useUserMock(),
}))

vi.mock('./doorKnockingSurface', () => ({
  useDoorKnockingServeMode: () => useDoorKnockingServeModeMock(),
  useDoorKnockingOfficeName: () => useDoorKnockingOfficeNameMock(),
  useDoorKnockingCanvasser: () => useDoorKnockingCanvasserMock(),
}))

import { useDoorScript } from './useDoorScript'
import { DEPARTURE_NOTE } from './talkingPointsCard'

// A card as the wizard froze it: the four sections in order, newline
// separated, exactly as `Outreach.script` holds them.
const STORED = [
  'What would you fix around here first?',
  'Fix our roads with a real maintenance plan.',
  'Point them to janedoe.org to learn more.',
  'Ask whether we can count on them in November.',
].join('\n')

// No name columns on the campaign payload — the intro's name comes from the
// user, so the fixtures keep the two sources apart.
const campaign = (overrides: Partial<Campaign> = {}) =>
  ({
    id: 7,
    positionName: 'City Council',
    ...overrides,
  }) as Campaign

const user = (overrides: Partial<User> = {}) =>
  ({
    firstName: 'Jane',
    lastName: 'Doe',
    ...overrides,
  }) as User

const wrapper = function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return React.createElement(QueryClientProvider, { client }, children)
}

beforeEach(() => {
  clientRequestMock.mockReset()
  useCampaignMock.mockReset()
  useCampaignMock.mockReturnValue([campaign()])
  useUserMock.mockReset()
  useUserMock.mockReturnValue([user()])
  useDoorKnockingServeModeMock.mockReset()
  useDoorKnockingServeModeMock.mockReturnValue(false)
  useDoorKnockingOfficeNameMock.mockReset()
  useDoorKnockingOfficeNameMock.mockReturnValue('City Council')
  useDoorKnockingCanvasserMock.mockReset()
  useDoorKnockingCanvasserMock.mockReturnValue({
    isVolunteer: false,
    representing: null,
  })
  clientRequestMock.mockResolvedValue({ data: [] })
})

describe('useDoorScript', () => {
  it('merges the campaign positions with the custom issues', async () => {
    useCampaignMock.mockReturnValue([
      campaign({
        details: {
          customIssues: [{ title: 'Transit', position: 'Restore the bus.' }],
        },
      } as Partial<Campaign>),
    ])
    clientRequestMock.mockResolvedValue({
      data: [
        {
          id: 1,
          description: 'Fund the shelter.',
          order: 0,
          topIssue: { id: 5, name: 'Housing' },
          position: null,
        },
      ],
    })

    const { result } = renderHook(() => useDoorScript(), { wrapper })

    expect(result.current.intro).toBe(
      "Hi, I'm Jane Doe, running for City Council.",
    )
    await waitFor(() =>
      expect(result.current.issues.map((issue) => issue.title)).toEqual([
        'Housing',
        'Transit',
      ]),
    )
  })

  it('asks for the positions of the campaign in context', async () => {
    renderHook(() => useDoorScript(), { wrapper })

    await waitFor(() =>
      expect(clientRequestMock).toHaveBeenCalledWith(
        'GET /v1/campaigns/:id/positions',
        { id: '7' },
      ),
    )
  })

  // A canvasser mid-walk should not lose the whole sheet because one read for
  // talking points failed, so the intro still renders from campaign context.
  it('keeps the intro when the positions request fails', async () => {
    clientRequestMock.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useDoorScript(), { wrapper })

    await waitFor(() => expect(clientRequestMock).toHaveBeenCalled())
    expect(result.current.intro).toBe(
      "Hi, I'm Jane Doe, running for City Council.",
    )
    expect(result.current.issues).toEqual([])
  })

  // Talking points are built from the campaign and its issue positions, and a
  // Serve org has neither — so the hook must not spend the request at all,
  // not merely render nothing with it.
  it('does not fetch positions in serve mode', () => {
    useDoorKnockingServeModeMock.mockReturnValue(true)

    const { result } = renderHook(() => useDoorScript(), { wrapper })

    expect(clientRequestMock).not.toHaveBeenCalled()
    expect(result.current.issues).toEqual([])
  })

  // The half that was missing: not fetching left serve mode with the WIN
  // intro, built from whatever campaign row a dual-role org happened to hold,
  // so an official either introduced themselves as a candidate for their own
  // seat or said nothing at all.
  it('introduces an official by the office they hold', () => {
    useDoorKnockingServeModeMock.mockReturnValue(true)

    const { result } = renderHook(() => useDoorScript(), { wrapper })

    expect(result.current.intro).toBe(
      "Hi, I'm Jane Doe, your City Council Member.",
    )
  })

  // The word "running" is the Win rail's, and an elected official is not on a
  // ballot — asserted against the whole sentence rather than the office clause
  // so a future rewording cannot reintroduce it.
  it('never says running for in serve mode', () => {
    useDoorKnockingServeModeMock.mockReturnValue(true)
    useCampaignMock.mockReturnValue([campaign()])

    const { result } = renderHook(() => useDoorScript(), { wrapper })

    expect(result.current.intro).not.toContain('running')
  })

  // A Serve org whose office title has not resolved yet still has a person to
  // introduce, and the opener is worth more than the office clause it is
  // missing.
  it('introduces the official alone when the office is unknown', () => {
    useDoorKnockingServeModeMock.mockReturnValue(true)
    useDoorKnockingOfficeNameMock.mockReturnValue('')

    const { result } = renderHook(() => useDoorScript(), { wrapper })

    expect(result.current.intro).toBe("Hi, I'm Jane Doe.")
  })

  it('still fetches positions in win mode', async () => {
    renderHook(() => useDoorScript(), { wrapper })

    await waitFor(() =>
      expect(clientRequestMock).toHaveBeenCalledWith(
        'GET /v1/campaigns/:id/positions',
        { id: '7' },
      ),
    )
  })

  it('does not fetch before the campaign is known', () => {
    useCampaignMock.mockReturnValue([undefined])

    const { result } = renderHook(() => useDoorScript(), { wrapper })

    expect(clientRequestMock).not.toHaveBeenCalled()
    // The clauses are independent, so a known name still introduces the
    // candidate while the office is outstanding. This is a LOADING state and
    // only a loading state — a volunteer, for whom the campaign is null
    // permanently rather than briefly, takes the branch covered below instead
    // of resolving here.
    expect(result.current).toEqual({
      intro: "Hi, I'm Jane Doe.",
      issues: [],
      points: [],
    })
  })

  it('is silent until either source has loaded', () => {
    useCampaignMock.mockReturnValue([undefined])
    useUserMock.mockReturnValue([null])

    const { result } = renderHook(() => useDoorScript(), { wrapper })

    expect(result.current).toEqual({ intro: '', issues: [], points: [] })
  })

  // The volunteer walk, which had no branch here at all. `useCampaign()` is
  // null for a volunteer permanently — `GET /v1/campaigns/mine` 403s them
  // (ENG-11072) — so every case below used to fall through the candidate path
  // and resolve to the volunteer's own name under a "Talking points" heading.
  describe('for a volunteer', () => {
    const asVolunteer = (
      representing: { name: string; office: string } | null,
    ) => {
      // What the volunteer's session actually holds: no campaign, and a user
      // who is not the candidate.
      useCampaignMock.mockReturnValue([null])
      useUserMock.mockReturnValue([{ firstName: 'Sam', lastName: 'Reed' }])
      useDoorKnockingCanvasserMock.mockReturnValue({
        isVolunteer: true,
        representing,
      })
    }

    it('names the campaign the volunteer is canvassing for', () => {
      asVolunteer({ name: 'Jane Doe', office: 'City Council' })

      const { result } = renderHook(() => useDoorScript(), { wrapper })

      expect(result.current.intro).toBe(
        "Hi, I'm Sam Reed, and I'm a volunteer with Jane Doe's campaign for City Council.",
      )
    })

    // The failure this branch exists to prevent, and the sharper half of the
    // bug: a volunteer reaching the Serve path would be introduced, by their
    // own name, as the office holder.
    it('never introduces the volunteer as the office holder', () => {
      asVolunteer({ name: 'Jane Doe', office: 'City Council' })
      useDoorKnockingServeModeMock.mockReturnValue(true)

      const { result } = renderHook(() => useDoorScript(), { wrapper })

      expect(result.current.intro).toBe(
        "Hi, I'm Sam Reed, and I'm a volunteer for Jane Doe, your City Council Member.",
      )
      expect(result.current.intro).not.toBe(
        "Hi, I'm Sam Reed, your City Council Member.",
      )
    })

    // "campaign for" is a claim about a ballot an elected official is not on —
    // the Win wording cannot be reused on the Serve rail with a word swapped.
    it('never says campaign or running on the serve rail', () => {
      asVolunteer({ name: 'Jane Doe', office: 'City Council' })
      useDoorKnockingServeModeMock.mockReturnValue(true)

      const { result } = renderHook(() => useDoorScript(), { wrapper })

      expect(result.current.intro).not.toContain('campaign')
      expect(result.current.intro).not.toContain('running')
    })

    // `representing` is best-effort on the payload, so this is a real state and
    // not a hypothetical. It degrades to what the card said before rather than
    // to a sentence naming nobody.
    it('falls back to the volunteer alone when the payload carries no campaign', () => {
      asVolunteer(null)

      const { result } = renderHook(() => useDoorScript(), { wrapper })

      expect(result.current).toEqual({
        intro: "Hi, I'm Sam Reed.",
        issues: [],
        points: [],
      })
    })

    // The office clause drops on its own, the same way it does in the two
    // candidate builders.
    it('drops the office clause when only the candidate resolved', () => {
      asVolunteer({ name: 'Jane Doe', office: '' })

      const { result } = renderHook(() => useDoorScript(), { wrapper })

      expect(result.current.intro).toBe(
        "Hi, I'm Sam Reed, and I'm a volunteer with Jane Doe's campaign.",
      )
    })

    // The positions endpoint is the candidate's own and 403s a volunteer, so
    // the request must never be spent — not merely render nothing.
    it('never asks for the campaign positions', () => {
      asVolunteer({ name: 'Jane Doe', office: 'City Council' })

      const { result } = renderHook(() => useDoorScript(), { wrapper })

      expect(clientRequestMock).not.toHaveBeenCalled()
      expect(result.current.issues).toEqual([])
    })

    // The card is on the route payload precisely so this path can read it: a
    // volunteer cannot call the positions endpoint, so before the wizard's
    // points step they had an opener and nothing under it.
    it('reads the stored card the same as the candidate does', () => {
      asVolunteer({ name: 'Jane Doe', office: 'City Council' })

      const { result } = renderHook(() => useDoorScript(STORED), { wrapper })

      expect(result.current.intro).toContain('volunteer')
      expect(result.current.points).toEqual([
        'What would you fix around here first?',
        'Fix our roads with a real maintenance plan.',
        'Point them to janedoe.org to learn more.',
        'Ask whether we can count on them in November.',
        DEPARTURE_NOTE,
      ])
    })
  })

  // The card the candidate wrote for this LIST, frozen with it and served on
  // the route payload.
  describe('with a stored card', () => {
    it('reads the four stored lines under the opener, and closes', () => {
      const { result } = renderHook(() => useDoorScript(STORED), { wrapper })

      expect(result.current.intro).toBe(
        "Hi, I'm Jane Doe, running for City Council.",
      )
      expect(result.current.points).toEqual([
        'What would you fix around here first?',
        'Fix our roads with a real maintenance plan.',
        'Point them to janedoe.org to learn more.',
        'Ask whether we can count on them in November.',
        DEPARTURE_NOTE,
      ])
    })

    // Both are answers to "what do I say here" and a door is not the place to
    // read two. The stances are the fallback, so the fetch is not spent either
    // — the same argument the serve and volunteer branches make.
    it('replaces the issue stances rather than joining them', async () => {
      useCampaignMock.mockReturnValue([
        campaign({
          details: {
            customIssues: [{ title: 'Transit', position: 'Restore the bus.' }],
          },
        } as Partial<Campaign>),
      ])

      const { result } = renderHook(() => useDoorScript(STORED), { wrapper })

      await waitFor(() => expect(result.current.points).not.toHaveLength(0))
      expect(result.current.issues).toEqual([])
      expect(clientRequestMock).not.toHaveBeenCalled()
    })

    // An official's canvasser gets the card too — the Serve rail's opener with
    // the list's own lines under it, where before it was the opener alone.
    it('gives an official the card under the serve opener', () => {
      useDoorKnockingServeModeMock.mockReturnValue(true)

      const { result } = renderHook(() => useDoorScript(STORED), { wrapper })

      expect(result.current.intro).toBe(
        "Hi, I'm Jane Doe, your City Council Member.",
      )
      expect(result.current.points).toHaveLength(5)
    })

    // Every list frozen before the points step shipped, plus anything this
    // version cannot read. Both fall back to the static build rather than to
    // half a card.
    it('falls back to the stances for a list with no card', async () => {
      useCampaignMock.mockReturnValue([
        campaign({
          details: {
            customIssues: [{ title: 'Transit', position: 'Restore the bus.' }],
          },
        } as Partial<Campaign>),
      ])

      const { result } = renderHook(() => useDoorScript(undefined), { wrapper })

      await waitFor(() =>
        expect(result.current.issues.map((issue) => issue.title)).toEqual([
          'Transit',
        ]),
      )
      expect(result.current.points).toEqual([])
    })

    it('falls back for a stored value it cannot parse', () => {
      const { result } = renderHook(
        () => useDoorScript('Hi, this is Jane calling about…'),
        { wrapper },
      )

      expect(result.current.points).toEqual([])
    })

    // A blank section drops out rather than printing an empty bullet at a
    // door — a campaign with no website on file has no call to action.
    it('drops a section the candidate left blank', () => {
      const { result } = renderHook(
        () => useDoorScript('Question?\nContext.\n\nAsk.'),
        { wrapper },
      )

      expect(result.current.points).toEqual([
        'Question?',
        'Context.',
        'Ask.',
        DEPARTURE_NOTE,
      ])
    })
  })
})
