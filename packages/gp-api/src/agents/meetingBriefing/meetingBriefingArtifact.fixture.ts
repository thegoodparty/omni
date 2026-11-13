const source = {
  id: 'src_pkt_001',
  name: 'Agenda Commentary — Lift Station 33 (pp. 76–77)',
  url: 'https://example.gov/packet.pdf',
  source_type: 'agenda_packet',
  retrieved_at: '2026-05-14T12:00:00Z',
  retrieved_text_or_snapshot: 'Staff recommends approval of $1,200,000.',
}

const chunk = {
  chunk_id: 'item_001_s001',
  item_id: 'item_001',
  item_title: 'Lift Station 33',
  tier: 'featured',
  source_id: 'src_pkt_001',
  pages: [76, 77],
  section_heading: 'Agenda Commentary',
  text: 'Staff recommends approval of $1,200,000.',
}

const runMetadata = {
  agenda_packet_url: 'https://example.gov/packet.pdf',
  discovered_agenda_location: 'https://example.gov/agendas',
  agenda_availability: 'full_packet',
  packet_stated_meeting_date: '2026-05-19',
  packet_date_verification: 'matched',
  source_bundle_retrieved_at: '2026-05-14T12:00:00Z',
  briefing_version: 'v2',
  run_decisions: [
    {
      timestamp: '2026-05-14T12:00:00Z',
      decision: 'triage_source',
      reason: 'priorities (1 active)',
    },
  ],
}

export const fullBriefing = {
  experiment_id: 'meeting_briefing',
  briefing_type: 'city_council_meeting',
  briefing_status: 'briefing_ready',
  generated_at: '2026-05-14T12:00:00Z',
  official_name: 'Rowan Ledbetter',
  meeting_name: 'City Council',
  location: 'City Hall',
  meeting_date: '2026-05-19',
  meeting_time: '17:45',
  meeting_timezone: 'America/New_York',
  estimated_read_minutes: 8,
  executive_summary: {
    lead_in:
      'The following items on your agenda require action and/or have a vote:',
    items: [
      {
        item_id: 'item_001',
        title: 'Lift Station 33',
        overview: 'Vote on a $1,200,000 lift station rebuild.',
        priority_id: 'priority-1',
      },
    ],
  },
  run_metadata: runMetadata,
  items: [
    {
      id: 'item_001',
      item_number: '5F',
      title: 'Lift Station 33',
      tier: 'featured',
      vote_required: true,
      tier_reason: ['vote_required'],
      display: {
        summary: 'Rebuilds the lift station.',
        constituent_sentiment: null,
        recent_news: null,
        budget_impact: {
          summary: 'One-time cost.',
          figures: [
            { label: 'Total', value: '$1,200,000', source_id: 'src_pkt_001' },
          ],
          source_ids: ['src_pkt_001'],
        },
        talking_points: [
          { text: 'Ask staff about the bid.', why: 'It was a sole bid.' },
          { text: 'Ask about the timeline.', why: 'Rain season.' },
          { text: 'Ask about the warranty.', why: 'Prior failure.' },
        ],
      },
      research: { raw_context: [chunk], full_treatment: null },
    },
  ],
  claims: [
    {
      claim_id: 'claim_001',
      item_id: 'item_001',
      section: 'budget_impact',
      claim_text: 'The rebuild costs $1,200,000.',
      claim_type: 'budget_number',
      claim_weight: 'high',
      source_extracts: ['approval of $1,200,000'],
      source_ids: ['src_pkt_001'],
      required_source_type: 'agenda_packet',
      route_if_unsupported: 'block_release',
    },
  ],
  sources: [source],
  required_data_points: [
    {
      name: 'summary',
      scope: 'all_items',
      required: true,
      citation_required: false,
      allowed_source_types: ['agenda_packet'],
    },
  ],
  disclosure: 'This briefing was generated with AI assistance.',
}

export const placeholder = {
  ...fullBriefing,
  briefing_status: 'awaiting_agenda',
  meeting_time: '',
  executive_summary: {
    lead_in: 'Check back closer to the meeting.',
    items: [],
  },
  items: [
    {
      id: 'item_001',
      item_number: null,
      title: 'Agenda not yet published',
      tier: 'standard',
      vote_required: false,
      tier_reason: ['placeholder'],
      display: { summary: 'Agenda not yet published' },
      research: {
        raw_context: [{ ...chunk, tier: 'standard' }],
        full_treatment: null,
      },
    },
  ],
  claims: [],
}
