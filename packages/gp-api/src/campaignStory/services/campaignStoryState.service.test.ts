import { describe, expect, it, vi } from 'vitest'
import type { CampaignStoryService } from './campaignStory.service'
import type { WebsitesService } from '@/websites/services/websites.service'
import { CampaignStoryStateService } from './campaignStoryState.service'

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
