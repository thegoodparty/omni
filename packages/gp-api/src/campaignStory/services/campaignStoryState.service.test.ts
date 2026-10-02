import { describe, expect, it, vi } from 'vitest'
import type { CampaignStoryService } from './campaignStory.service'
import type { WebsitesService } from '@/websites/services/websites.service'
import {
  CampaignStoryStateService,
  fingerprintStory,
} from './campaignStoryState.service'

const build = ({
  background = 'my background',
  bio = '<p>my why</p>',
  issues = [{ title: 'Roads', description: '<p>Fix them</p>' }],
}: {
  background?: string | null
  bio?: string | null
  issues?: { title?: string; description?: string }[]
} = {}): CampaignStoryStateService =>
  new CampaignStoryStateService(
    {
      getForCampaign: vi.fn(() => Promise.resolve({ background })),
    } as unknown as CampaignStoryService,
    {
      getBioForCampaign: vi.fn(() => Promise.resolve(bio)),
      getIssuesForCampaign: vi.fn(() => Promise.resolve(issues)),
    } as unknown as WebsitesService,
  )

describe('CampaignStoryStateService.read', () => {
  it('is complete with a why, a background and at least one issue', async () => {
    const state = await build().read(42)

    expect(state.complete).toBe(true)
    expect(state.missing).toEqual([])
  })

  it.each([
    ['why', { bio: null }],
    ['background', { background: null }],
    ['positions', { issues: [] }],
  ])('reports %s missing', async (field: string, overrides) => {
    const state = await build(overrides).read(42)

    expect(state.complete).toBe(false)
    expect(state.missing).toContain(field)
  })

  it('reports every missing field at once', async () => {
    const state = await build({
      background: null,
      bio: null,
      issues: [],
    }).read(42)

    expect(state.missing).toEqual(['why', 'background', 'positions'])
  })

  it('treats a whitespace-only background as missing', async () => {
    const state = await build({ background: '   ' }).read(42)

    expect(state.missing).toContain('background')
  })

  // The bio is Quill HTML. A bare `.trim()` reads an empty editor as answered,
  // which let the backend call a story complete while the webapp — which
  // strips markup before measuring — called it incomplete. The visible symptom
  // was the tracker's story task being deleted while the pinned card stayed.
  it.each([['<p></p>'], ['<p>&nbsp;</p>'], ['<p><br></p>'], ['   ']])(
    'treats an empty-editor bio (%s) as a missing why',
    async (bio: string) => {
      const state = await build({ bio }).read(42)

      expect(state.missing).toContain('why')
      expect(state.complete).toBe(false)
    },
  )

  it('keeps a bio whose only content is an HTML entity', async () => {
    const state = await build({ bio: '<p>Fund &lt;$50M schools</p>' }).read(42)

    expect(state.missing).not.toContain('why')
    expect(state.complete).toBe(true)
  })

  // `why` is returned raw for callers that want the original markup; only the
  // completeness decision strips it.
  it('returns the bio unmodified', async () => {
    const state = await build({ bio: '<p>my why</p>' }).read(42)

    expect(state.why).toBe('<p>my why</p>')
  })
})

// The fingerprint decides when a candidate has "changed their story", and the
// campaign plan regenerates on that — so a hash that moves too easily bills
// them for a formatting change, and one that moves too rarely leaves the plan
// describing a story they have rewritten.
describe('fingerprintStory', () => {
  const state = (overrides = {}) => ({
    why: '<p>my why</p>',
    background: 'my background',
    positions: [{ title: 'Roads', description: 'Fix them' }],
    complete: true,
    missing: [],
    ...overrides,
  })

  it('is stable for the same answers', () => {
    expect(fingerprintStory(state())).toBe(fingerprintStory(state()))
  })

  it.each([
    ['why', { why: '<p>a different why</p>' }],
    ['background', { background: 'a different background' }],
    [
      'a position title',
      { positions: [{ title: 'Parks', description: 'Fix them' }] },
    ],
    [
      'a position description',
      { positions: [{ title: 'Roads', description: 'Pave them' }] },
    ],
    [
      'an added position',
      {
        positions: [
          { title: 'Roads', description: 'Fix them' },
          { title: 'Parks', description: 'More of them' },
        ],
      },
    ],
  ])('moves when the candidate edits %s', (_label, overrides) => {
    expect(fingerprintStory(state(overrides))).not.toBe(
      fingerprintStory(state()),
    )
  })

  // Order is meaningful: the plan treats the first position as the lead issue.
  it('moves when positions are reordered', () => {
    const ordered = state({
      positions: [
        { title: 'Roads', description: 'Fix them' },
        { title: 'Parks', description: 'More of them' },
      ],
    })
    const reversed = state({
      positions: [
        { title: 'Parks', description: 'More of them' },
        { title: 'Roads', description: 'Fix them' },
      ],
    })

    expect(fingerprintStory(ordered)).not.toBe(fingerprintStory(reversed))
  })

  // The same serializer completeness uses, so an empty Quill editor and a
  // genuinely empty bio cannot disagree about whether the story moved.
  it('does not move when an empty editor is saved in a different empty form', () => {
    expect(fingerprintStory(state({ why: '<p></p>' }))).toBe(
      fingerprintStory(state({ why: '<p>&nbsp;</p>' })),
    )
  })

  it('does not move when background whitespace changes', () => {
    expect(fingerprintStory(state({ background: '  my background  ' }))).toBe(
      fingerprintStory(state()),
    )
  })

  // `complete` and `missing` are derived from the three answers, so including
  // them would let the hash move for something that is not an edit.
  it('ignores the derived completeness fields', () => {
    expect(fingerprintStory(state({ complete: false, missing: ['why'] }))).toBe(
      fingerprintStory(state()),
    )
  })
})
