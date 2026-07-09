import { describe, expect, it } from 'vitest'
import { sanitizeBriefingArtifact } from './briefingSanitizer'

// A representative artifact carrying both user-facing fields and the internal
// scaffolding that must never reach the model.
const fullArtifact = {
  briefing_status: 'briefing_ready',
  briefing_type: 'city_council_meeting',
  meeting_date: '2026-05-19',
  meeting_time: '18:30',
  meeting_timezone: 'America/New_York',
  meeting_name: 'Regular Council Meeting',
  location: 'City Hall',
  estimated_read_minutes: 8,
  disclosure: 'Standard disclaimer.',
  experiment_id: 'exp-123',
  generated_at: '2026-05-12T12:00:00Z',
  run_metadata: {
    agenda_packet_url: 'https://internal.example.gov/packet.pdf',
    run_decisions: [{ decision: 'd', reason: 'r', timestamp: 't' }],
    source_bundle_retrieved_at: '2026-05-12T11:00:00Z',
  },
  claims: [
    {
      claim_id: 'c1',
      claim_text: 'budget is $1.8M',
      route_if_unsupported: 'block_release',
      source_ids: ['s1'],
    },
  ],
  executive_summary: {
    lead_in: 'Two contentious items.',
    items: [
      {
        item_id: 'item_001',
        title: 'STR Ordinance',
        overview: 'A cap on STRs.',
      },
    ],
  },
  items: [
    {
      id: 'item_001',
      item_number: '5F',
      title: 'STR Ordinance',
      tier: 'featured',
      vote_required: true,
      tier_reason: ['vote_required'],
      research: {
        raw_context: [{ chunk_id: 'k1', text: 'secret internal context' }],
        full_treatment: {
          haystaq_detail: {
            haystaq_column: 'hs_str_support',
            query_executed: 'SELECT hs_str_support FROM l2_voters',
          },
        },
      },
      display: {
        summary: 'Staff recommends a cap.',
        budget_impact: { summary: '$1.8M at stake.' },
        constituent_sentiment: { summary: 'Neighbors support.' },
        talking_points: ['Point A', 'Point B'],
        recent_news: [
          {
            headline: 'Council weighs STR cap',
            publication: 'Local Times',
            publication_date: '2026-05-10',
            url: 'https://news.example.com/str',
          },
        ],
      },
    },
  ],
  sources: [
    {
      id: 's1',
      name: 'Agenda packet',
      source_type: 'agenda_packet',
      url: 'https://example.gov/agenda',
      haystaq_column: 'hs_str_support',
      score_value: 0.42,
      district_voters_n: 1234,
    },
  ],
}

describe('sanitizeBriefingArtifact', () => {
  it('returns null for a non-object artifact', () => {
    expect(sanitizeBriefingArtifact(null)).toBeNull()
    expect(sanitizeBriefingArtifact('a string')).toBeNull()
    expect(sanitizeBriefingArtifact([1, 2, 3])).toBeNull()
  })

  it('projects the user-facing fields', () => {
    const out = sanitizeBriefingArtifact(fullArtifact)
    expect(out).not.toBeNull()
    expect(out?.briefingStatus).toBe('briefing_ready')
    expect(out?.meetingName).toBe('Regular Council Meeting')
    expect(out?.estimatedReadMinutes).toBe(8)
    expect(out?.leadIn).toBe('Two contentious items.')
    expect(out?.executiveSummaryItems[0]?.itemId).toBe('item_001')
    expect(out?.items[0]?.title).toBe('STR Ordinance')
    expect(out?.items[0]?.voteRequired).toBe(true)
    expect(out?.items[0]?.summary).toBe('Staff recommends a cap.')
    expect(out?.items[0]?.budgetImpactSummary).toBe('$1.8M at stake.')
    expect(out?.items[0]?.talkingPoints).toEqual(['Point A', 'Point B'])
    expect(out?.items[0]?.recentNews[0]?.headline).toBe(
      'Council weighs STR cap',
    )
    expect(out?.sources[0]?.name).toBe('Agenda packet')
  })

  it('excludes internal QA scaffolding entirely', () => {
    const out = sanitizeBriefingArtifact(fullArtifact)
    const serialized = JSON.stringify(out)
    expect(serialized).not.toContain('run_metadata')
    expect(serialized).not.toContain('agenda_packet_url')
    expect(serialized).not.toContain('claims')
    expect(serialized).not.toContain('route_if_unsupported')
    expect(serialized).not.toContain('raw_context')
    expect(serialized).not.toContain('secret internal context')
    expect(serialized).not.toContain('experiment_id')
    expect(serialized).not.toContain('tier_reason')
    expect(serialized).not.toContain('research')
  })

  it('excludes haystaq / internal column identifiers (hs_ / l2_)', () => {
    const out = sanitizeBriefingArtifact(fullArtifact)
    const serialized = JSON.stringify(out)
    expect(serialized).not.toContain('hs_')
    expect(serialized).not.toContain('l2_')
    expect(serialized).not.toContain('haystaq_column')
    expect(serialized).not.toContain('query_executed')
    expect(serialized).not.toContain('score_value')
  })

  it('keeps the source allowlist fields but drops internal source fields', () => {
    const out = sanitizeBriefingArtifact(fullArtifact)
    expect(out?.sources[0]).toEqual({
      id: 's1',
      name: 'Agenda packet',
      sourceType: 'agenda_packet',
      url: 'https://example.gov/agenda',
    })
  })

  it('folds {text, why} talking points into a single string instead of dropping them', () => {
    // All new generations emit talking_points as {text, why} objects. The
    // sanitizer must fold both fields into the string[] the chat context
    // expects — filtering on typeof === 'string' would silently erase every
    // talking point on any briefing generated after the shape shipped.
    const withStructuredPoints = {
      ...fullArtifact,
      items: [
        {
          ...fullArtifact.items[0],
          display: {
            ...fullArtifact.items[0]?.display,
            talking_points: [
              {
                text: 'Ask staff to confirm the fee tier.',
                why: 'Avoids an ambiguous vote record.',
              },
              'A legacy bare-string point.',
            ],
          },
        },
      ],
    }
    const out = sanitizeBriefingArtifact(withStructuredPoints)
    expect(out?.items[0]?.talkingPoints).toEqual([
      'Ask staff to confirm the fee tier. (Why: Avoids an ambiguous vote record.)',
      'A legacy bare-string point.',
    ])
  })
})
