import { describe, expect, it, vi } from 'vitest'
import {
  BriefingReadProvider,
  buildGetBriefingTool,
  buildListBriefingsTool,
} from './briefingReadTools'
import type { SanitizedBriefingArtifact } from './briefingSanitizer'

const artifact = {
  briefing_status: 'briefing_ready',
  meeting_name: 'Council',
  executive_summary: { lead_in: 'Hi', items: [] },
  items: [
    {
      id: 'i1',
      title: 'Item',
      tier: 'featured',
      display: { summary: 'A summary' },
      research: { raw_context: [{ text: 'internal-only' }] },
    },
  ],
  sources: [
    { id: 's1', name: 'Src', source_type: 'news', haystaq_column: 'hs_x' },
  ],
  run_metadata: { agenda_packet_url: 'https://internal/packet' },
}

const buildProvider = (
  overrides: Partial<BriefingReadProvider> = {},
): BriefingReadProvider => ({
  list: vi.fn(() =>
    Promise.resolve([
      { meetingDate: '2026-05-19', meetingName: 'Council', status: 'ready' },
    ]),
  ),
  getByDate: vi.fn(() => Promise.resolve(artifact)),
  ...overrides,
})

describe('briefing read tools', () => {
  it('list_briefings returns the provider rows', async () => {
    const tool = buildListBriefingsTool({ provider: buildProvider() })
    const result = await tool.execute({})
    expect(result).toEqual([
      { meetingDate: '2026-05-19', meetingName: 'Council', status: 'ready' },
    ])
  })

  it('get_briefing returns a sanitized artifact (no internal fields)', async () => {
    const tool = buildGetBriefingTool({ provider: buildProvider() })
    const result = (await tool.execute({
      meetingDate: '2026-05-19',
    })) as SanitizedBriefingArtifact | null
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('run_metadata')
    expect(serialized).not.toContain('agenda_packet_url')
    expect(serialized).not.toContain('raw_context')
    expect(serialized).not.toContain('internal-only')
    expect(serialized).not.toContain('hs_')
    expect(serialized).not.toContain('research')
    expect(result?.items[0]?.summary).toBe('A summary')
    expect(result?.sources[0]).toEqual({
      id: 's1',
      name: 'Src',
      sourceType: 'news',
      url: null,
    })
  })

  it('get_briefing returns null when no artifact exists', async () => {
    const tool = buildGetBriefingTool({
      provider: buildProvider({ getByDate: () => Promise.resolve(null) }),
    })
    expect(await tool.execute({ meetingDate: '2026-05-19' })).toBeNull()
  })
})
