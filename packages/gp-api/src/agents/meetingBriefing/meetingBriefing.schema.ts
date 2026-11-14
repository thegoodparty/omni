import { z } from 'zod'

export const TalkingPointSchema = z.strictObject({
  text: z
    .string()
    .min(1)
    .describe(
      'The bullet itself — the ask, question, or framing to bring into the room.',
    ),
  why: z
    .string()
    .min(1)
    .describe(
      'Rationale for the talking point: why it matters strategically, whether raising it risks making the official look uninformed, and how to handle the likely response.',
    ),
})

export const ConstituentSentimentSchema = z.strictObject({
  summary: z.string().min(1),
  detail: z.string().nullable().optional(),
  district_note: z.string().nullable().optional(),
  haystaq_column: z.string().regex(/^hs_[a-z0-9_]+$/),
  mean_score: z.number().min(0).max(100),
  score_direction: z
    .string()
    .min(1)
    .describe(
      'Short string describing what high values represent. Derived from the catalog entry\'s `meaning` field (e.g. "supports gun control").',
    ),
  voter_count: z.number().int().min(0),
  haystaq_status: z.enum(['ok', 'no_match', 'city_mismatch', 'no_column']),
  source_ids: z
    .array(z.string().min(1))
    .describe(
      'References to ids in the top-level sources[] list that back this section as a whole. Required-but-may-be-empty: emit [] when no specific source cites the section (rare for haystaq sentiment, which should reference the Haystaq source entry). Authors must not fabricate citations to pad this list.',
    ),
})

export const RecentNewsEntrySchema = z.strictObject({
  headline: z.string().min(1),
  publication: z.string().min(1),
  article_type: z.enum([
    'reporting',
    'opinion',
    'editorial',
    'press_release',
    'government_communication',
  ]),
  publication_date: z.iso
    .date()
    .describe(
      'Required, non-nullable. Must be within 60 days of PARAMS.meetingDate (see instruction.md Step 11) — the qa/ gate rejects entries older than that or missing this field.',
    ),
  url: z.string().regex(/^https?:\/\//),
  source_id: z
    .string()
    .nullable()
    .describe(
      'Optional cross-reference to a sources[] entry id; populate when the article also appears in sources[].',
    )
    .optional(),
})

export const BudgetImpactSchema = z.strictObject({
  summary: z.string().min(1),
  figures: z
    .array(
      z.strictObject({
        label: z.string().min(1),
        value: z.string().min(1),
        source_id: z.string().min(1),
      }),
    )
    .min(1),
  source_ids: z
    .array(z.string().min(1))
    .describe(
      "References to ids in the top-level sources[] list that back this section as a whole. Complements per-figure figures[].source_id (which cites the specific document a number was extracted from); this section-level list cites the section overall and renders as inline source pills in the UI. Required-but-may-be-empty: emit [] when the section's narrative draws solely from figures whose source_id already covers it.",
    ),
})

export const ItemDisplaySchema = z.strictObject({
  summary: z.string().min(1),
  constituent_sentiment: ConstituentSentimentSchema.nullable().optional(),
  recent_news: z
    .array(RecentNewsEntrySchema)
    .min(1)
    .max(3)
    .nullable()
    .optional(),
  budget_impact: BudgetImpactSchema.nullable().optional(),
  talking_points: z
    .union([
      z.array(z.string().min(1)).min(3).max(5),
      z.array(TalkingPointSchema).min(3).max(5),
    ])
    .nullable()
    .optional(),
})

export const RawContextChunkSchema = z.strictObject({
  chunk_id: z.string().min(1),
  item_id: z.string().regex(/^item_[0-9]{3}$/),
  item_title: z.string().min(1),
  tier: z.enum(['featured', 'queued', 'standard']),
  source_id: z.string().min(1),
  pages: z.array(z.number().int().min(1)).min(1),
  section_heading: z.string().nullable().optional(),
  text: z.string().min(1),
})

export const HaystaqDetailSchema = z.strictObject({
  haystaq_status: z.enum(['ok', 'no_match', 'city_mismatch', 'no_column']),
  haystaq_column: z
    .string()
    .regex(/^hs_[a-z0-9_]+$/)
    .nullable(),
  city_mean_score: z.number().min(0).max(100).nullable().optional(),
  district_mean_score: z.number().min(0).max(100).nullable().optional(),
  city_voter_count: z.number().int().min(0).nullable().optional(),
  district_voter_count: z.number().int().min(0).nullable().optional(),
  complementary_field: z.string().nullable().optional(),
  query_executed: z.string().nullable().optional(),
})

export const NewsArticleSchema = z.strictObject({
  headline: z.string().min(1),
  publication: z.string().min(1),
  article_type: z.enum([
    'reporting',
    'opinion',
    'editorial',
    'press_release',
    'government_communication',
  ]),
  publication_date: z.iso.date().nullable().optional(),
  url: z.string().regex(/^https?:\/\//),
  body_text: z.string(),
})

export const BudgetDetailSchema = z.strictObject({
  figures: z
    .array(
      z.strictObject({
        label: z.string().min(1),
        value: z.string().min(1),
        verbatim_extract: z.string().min(1),
      }),
    )
    .min(1),
})

export const FullTreatmentSchema = z.strictObject({
  haystaq_detail: HaystaqDetailSchema.nullable(),
  news_articles: z.array(NewsArticleSchema).nullable(),
  budget_detail: BudgetDetailSchema.nullable(),
})

export const ItemResearchSchema = z.strictObject({
  raw_context: z.array(RawContextChunkSchema).min(1),
  full_treatment: FullTreatmentSchema.nullable(),
})

export const BriefingItemSchema = z.strictObject({
  id: z.string().regex(/^item_[0-9]{3}$/),
  item_number: z
    .string()
    .nullable()
    .describe(
      "Agenda item number as a string (e.g. '5F'). Set to null only for the single placeholder item emitted when briefing_status is awaiting_agenda or no_meeting_found.",
    ),
  title: z.string().min(1),
  tier: z.enum(['featured', 'queued', 'standard']),
  vote_required: z.boolean(),
  tier_reason: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      "Free-form short snake_case reasons explaining the tier assignment. Preferred values for the common cases: 'vote_required', 'public_position_required', 'budget_threshold', 'constituent_alignment', 'procedural', 'ceremonial', 'consent_routine', 'first_reading_only', 'received_and_filed_or_callup', 'land_use_referral', 'out_of_district', 'symbolic_resolution', 'placeholder'. Agent may use a domain-specific reason when none of the preferred values fit, but reuse preferred values when they apply (do not invent 'procedural_minutes' when 'procedural' already covers it).",
    ),
  display: ItemDisplaySchema,
  research: ItemResearchSchema,
})

export const ExecutiveSummarySchema = z.strictObject({
  lead_in: z
    .string()
    .min(1)
    .max(300)
    .describe(
      "Single framing sentence at the top of the briefing. For briefing_ready artifacts: defaults to 'The following items on your agenda require action and/or have a vote:' (with trailing colon when items follow). For awaiting_agenda / no_meeting_found / error: a check-back or no-meeting message; items[] is empty.",
    ),
  items: z
    .array(
      z.strictObject({
        item_id: z
          .string()
          .regex(/^item_[0-9]{3}$/)
          .describe(
            "Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.",
          ),
        title: z
          .string()
          .min(1)
          .max(100)
          .describe(
            'Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).',
          ),
        overview: z
          .string()
          .min(1)
          .max(300)
          .describe(
            'One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.',
          ),
        priority_id: z.string().optional(),
        community_issue_id: z.string().optional(),
      }),
    )
    .max(5)
    .describe(
      'One entry per featured item in top-level items[], in the same order. Empty when no items qualify as featured (and for placeholder briefing_status values).',
    ),
})

export const ClaimSchema = z.strictObject({
  claim_id: z.string().regex(/^claim_[0-9]{3}$/),
  item_id: z.string().regex(/^item_[0-9]{3}$/),
  section: z.enum([
    'overview',
    'constituent_sentiment',
    'recent_news',
    'budget_impact',
    'talking_points',
  ]),
  claim_text: z.string().min(1),
  claim_type: z.enum([
    'budget_number',
    'vote_count',
    'legal_citation',
    'staff_recommendation',
    'constituent_sentiment',
    'news_context',
    'historical_context',
    'inferred',
  ]),
  claim_weight: z.enum(['high', 'medium', 'low']),
  source_extracts: z.array(z.string().min(1).max(2000)).min(1).max(10),
  source_ids: z.array(z.string().min(1)).min(1),
  required_source_type: z.enum([
    'agenda_packet',
    'government_website',
    'news',
    'haystaq',
    'none',
  ]),
  route_if_unsupported: z.enum([
    'block_release',
    'omit_claim',
    'flag_as_inferred',
  ]),
})

export const SourceSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z
    .string()
    .regex(/^https?:\/\//)
    .nullable()
    .optional(),
  source_type: z.enum([
    'agenda_packet',
    'news',
    'government_website',
    'campaign',
    'haystaq',
  ]),
  retrieved_at: z.iso.datetime({ offset: true }),
  retrieved_text_or_snapshot: z.string().min(1).max(50000),
  page_number: z.number().int().min(1).nullable().optional(),
  section_heading: z.string().nullable().optional(),
  article_date: z.iso.date().nullable().optional(),
  article_type: z
    .enum([
      'reporting',
      'opinion',
      'editorial',
      'press_release',
      'government_communication',
    ])
    .nullable()
    .optional(),
  publisher: z.string().nullable().optional(),
  haystaq_column: z.string().nullable().optional(),
  score_value: z.number().min(0).max(100).nullable().optional(),
  district_voters_n: z.number().int().min(0).nullable().optional(),
  specific_claim_found: z.string().nullable().optional(),
})

export const RequiredDataPointSchema = z.strictObject({
  name: z.string().min(1),
  scope: z.enum(['all_items', 'featured_queued', 'featured']),
  required: z.boolean(),
  citation_required: z.boolean(),
  allowed_source_types: z
    .array(
      z.enum([
        'agenda_packet',
        'news',
        'government_website',
        'campaign',
        'haystaq',
      ]),
    )
    .optional(),
  skip_reasons_allowed: z.array(z.string()).optional(),
})

export const PlaceholderItemSchema = z.strictObject({
  id: z.literal('item_001'),
  item_number: z.null(),
  title: z.string().min(1),
  tier: z.literal('standard'),
  vote_required: z.literal(false),
  tier_reason: z.array(z.literal('placeholder')).min(1).max(1),
  display: z.strictObject({
    summary: z.string().min(1),
    constituent_sentiment: z.null().optional(),
    recent_news: z.null().optional(),
    budget_impact: z.null().optional(),
    talking_points: z.null().optional(),
  }),
  research: z.strictObject({
    raw_context: z.array(RawContextChunkSchema).min(1),
    full_treatment: z.null(),
  }),
})

export const MeetingBriefingFullSchema = z.strictObject({
  experiment_id: z
    .string()
    .min(1)
    .describe('Experiment id, echoed from PARAMS.'),
  briefing_type: z
    .enum([
      'city_council_meeting',
      'county_legislature_meeting',
      'school_board_meeting',
    ])
    .describe('Self-identification of the briefing kind.'),
  briefing_status: z
    .enum(['briefing_ready', 'agenda_provided_by_user'])
    .describe('Full briefing produced. UI renders normal briefing.'),
  generated_at: z.iso
    .datetime({ offset: true })
    .describe('ISO 8601 UTC timestamp when the briefing was generated.'),
  official_name: z.string().min(1),
  meeting_name: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "Official name of the meeting body as the source refers to it (e.g. 'City Council', 'Planning Board'). Used as the list-row title in the candidate dashboard. Mirrors meeting_schedule.meeting_name when a schedule exists.",
    ),
  location: z
    .string()
    .max(300)
    .describe(
      "Customary location for the meeting (e.g. 'City Hall Council Chambers, 200 Main St'). Required-but-may-be-empty: emit an empty string when no source for the run mentions a venue (e.g. a user-supplied agenda PDF that lacks a header). Otherwise prefer the room-level location and fall back to building + street address when only the building is given.",
    ),
  meeting_date: z.iso
    .date()
    .describe(
      'YYYY-MM-DD. For agenda_provided_by_user or awaiting_agenda runs, this is the target meeting date; for no_meeting_found it may be an estimated next date.',
    ),
  meeting_time: z
    .string()
    .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
    .describe(
      'Start time of the meeting in 24-hour HH:MM format, in the local timezone given by meeting_timezone. Briefings own this independently of meeting_schedule so the row is self-sufficient.',
    ),
  meeting_timezone: z
    .string()
    .min(1)
    .describe(
      "IANA timezone name for meeting_time (e.g. 'America/Chicago'). Use the timezone the governing body publishes the meeting in, not UTC.",
    ),
  estimated_read_minutes: z.number().int().min(0),
  executive_summary: ExecutiveSummarySchema,
  run_metadata: z.strictObject({
    agenda_packet_url: z
      .string()
      .nullable()
      .describe(
        'Permanent URL to the agenda packet. May be null when briefing_status is awaiting_agenda or no_meeting_found.',
      ),
    discovered_agenda_location: z
      .string()
      .max(2000)
      .nullable()
      .describe(
        "Best current prose describing where future agenda packets will likely be found for this body, persisted by gp-api as a hint for subsequent runs. Prefer a URL to the PARENT page that lists meetings (e.g. the streaming platform's calendar, the city's agendas index, a CDN directory) — not the deep link to today's specific packet PDF. Prose with multi-step navigation is allowed when no single URL captures it. Emit even on awaiting_agenda / no_meeting_found runs when the parent page was still reachable; set to null only when no plausible future-run starting point exists.",
      ),
    agenda_availability: z
      .enum([
        'full_packet',
        'html_agenda',
        'partial',
        'not_published',
        'inferred_from_prior',
      ])
      .describe(
        "Fill on every run. v1 operational classification of how the target meeting's agenda was obtained. full_packet: the packet PDF(s) for this meeting were read. html_agenda: this meeting's agenda was read item by item from the platform's page, with no PDF reachable. partial: only some of this meeting's documents were reachable. not_published: the meeting is listed but no agenda is posted yet. inferred_from_prior: items were taken from other meetings' documents or news because this meeting's agenda was not reachable. partial, not_published, and inferred_from_prior require briefing_status awaiting_agenda.",
      )
      .optional(),
    packet_stated_meeting_date: z.iso
      .date()
      .nullable()
      .describe(
        'The meeting date the agenda document itself states, read from its cover or header. null when no date could be read.',
      )
      .optional(),
    packet_date_verification: z
      .enum(['matched', 'mismatched', 'unavailable'])
      .describe(
        'matched: packet_stated_meeting_date is within three days of meeting_date. mismatched: it is further off. unavailable: no date could be read from the document. Recorded so a missing date is a known state, not a silent pass.',
      )
      .optional(),
    source_bundle_retrieved_at: z.iso.datetime({ offset: true }),
    briefing_version: z.string().optional(),
    run_decisions: z
      .array(
        z.strictObject({
          timestamp: z.iso.datetime({ offset: true }),
          decision: z.string().min(1),
          reason: z.string().min(1),
        }),
      )
      .describe(
        'Curated trail of agent judgment calls. Separate from conversation/log.txt; this is QA-facing.',
      )
      .optional(),
  }),
  items: z.array(BriefingItemSchema).min(1),
  claims: z
    .array(ClaimSchema)
    .max(200)
    .describe(
      "May be empty when briefing_status is awaiting_agenda or no_meeting_found. Capped at 200 to bound the validator's O(claims × sources × extracts) substring scan.",
    ),
  sources: z.array(SourceSchema),
  required_data_points: z.array(RequiredDataPointSchema),
  disclosure: z
    .string()
    .min(1)
    .describe('Required verbatim disclaimer per required_disclosure.md.'),
})

export const MeetingBriefingPlaceholderSchema = z.strictObject({
  experiment_id: z
    .string()
    .min(1)
    .describe('Experiment id, echoed from PARAMS.'),
  briefing_type: z
    .enum([
      'city_council_meeting',
      'county_legislature_meeting',
      'school_board_meeting',
    ])
    .describe('Self-identification of the briefing kind.'),
  briefing_status: z
    .enum(['awaiting_agenda', 'no_meeting_found', 'error'])
    .describe(
      "Early-exit / placeholder artifact. UI renders a check-back state. Use 'awaiting_agenda' when the meeting is on the calendar but the agenda packet has not been published. Use 'no_meeting_found' when the streaming platform shows no meeting of the official's body on the caller-supplied PARAMS.meetingDate (stale schedule signal). Use 'error' for unrecoverable run failures — populate run_metadata.run_decisions[] with the diagnostic trail.",
    ),
  generated_at: z.iso
    .datetime({ offset: true })
    .describe('ISO 8601 UTC timestamp when the briefing was generated.'),
  official_name: z.string().min(1),
  meeting_name: z
    .string()
    .max(200)
    .describe(
      "Official name of the meeting body (e.g. 'City Council'). Required-but-may-be-empty: populate when the meeting is identified (awaiting_agenda), emit an empty string when no_meeting_found or error.",
    ),
  location: z
    .string()
    .max(300)
    .describe(
      'Customary location for the meeting. Required-but-may-be-empty: populate when the meeting is identified (awaiting_agenda), emit an empty string when no_meeting_found or error.',
    ),
  meeting_date: z.iso
    .date()
    .describe(
      'YYYY-MM-DD. For agenda_provided_by_user or awaiting_agenda runs, this is the target meeting date; for no_meeting_found it may be an estimated next date.',
    ),
  meeting_time: z
    .string()
    .regex(/^(([01][0-9]|2[0-3]):[0-5][0-9])?$/)
    .describe(
      'Start time of the meeting in 24-hour HH:MM format, in the local timezone given by meeting_timezone. Required-but-may-be-empty: populate when the meeting is identified (awaiting_agenda), emit an empty string when no_meeting_found or error.',
    ),
  meeting_timezone: z
    .string()
    .max(64)
    .describe(
      "IANA timezone name for meeting_time (e.g. 'America/Chicago'). Required-but-may-be-empty: populate when the meeting is identified, emit an empty string when no_meeting_found or error.",
    ),
  estimated_read_minutes: z.number().int().min(0),
  executive_summary: ExecutiveSummarySchema,
  run_metadata: z.strictObject({
    agenda_packet_url: z
      .string()
      .nullable()
      .describe(
        'Permanent URL to the agenda packet. May be null when briefing_status is awaiting_agenda or no_meeting_found.',
      ),
    discovered_agenda_location: z
      .string()
      .max(2000)
      .nullable()
      .describe(
        "Best current prose describing where future agenda packets will likely be found for this body, persisted by gp-api as a hint for subsequent runs. Prefer a URL to the PARENT page that lists meetings (e.g. the streaming platform's calendar, the city's agendas index, a CDN directory) — not the deep link to today's specific packet PDF. Prose with multi-step navigation is allowed when no single URL captures it. Emit even on awaiting_agenda / no_meeting_found runs when the parent page was still reachable; set to null only when no plausible future-run starting point exists.",
      ),
    agenda_availability: z
      .enum([
        'full_packet',
        'html_agenda',
        'partial',
        'not_published',
        'inferred_from_prior',
      ])
      .describe(
        "Fill on every run. v1 operational classification of how the target meeting's agenda was obtained. full_packet: the packet PDF(s) for this meeting were read. html_agenda: this meeting's agenda was read item by item from the platform's page, with no PDF reachable. partial: only some of this meeting's documents were reachable. not_published: the meeting is listed but no agenda is posted yet. inferred_from_prior: items were taken from other meetings' documents or news because this meeting's agenda was not reachable. partial, not_published, and inferred_from_prior require briefing_status awaiting_agenda.",
      )
      .optional(),
    packet_stated_meeting_date: z.iso
      .date()
      .nullable()
      .describe(
        'The meeting date the agenda document itself states, read from its cover or header. null when no date could be read.',
      )
      .optional(),
    packet_date_verification: z
      .enum(['matched', 'mismatched', 'unavailable'])
      .describe(
        'matched: packet_stated_meeting_date is within three days of meeting_date. mismatched: it is further off. unavailable: no date could be read from the document. Recorded so a missing date is a known state, not a silent pass.',
      )
      .optional(),
    source_bundle_retrieved_at: z.iso.datetime({ offset: true }),
    briefing_version: z.string().optional(),
    run_decisions: z
      .array(
        z.strictObject({
          timestamp: z.iso.datetime({ offset: true }),
          decision: z.string().min(1),
          reason: z.string().min(1),
        }),
      )
      .describe(
        'Curated trail of agent judgment calls. Separate from conversation/log.txt; this is QA-facing.',
      )
      .optional(),
  }),
  items: z.array(PlaceholderItemSchema).min(1).max(1),
  claims: z
    .array(ClaimSchema)
    .max(0)
    .describe('Always empty for placeholder/early-exit artifacts.'),
  sources: z.array(SourceSchema),
  required_data_points: z.array(RequiredDataPointSchema),
  disclosure: z
    .string()
    .min(1)
    .describe('Required verbatim disclaimer per required_disclosure.md.'),
})

export const MeetingBriefingSchema = z
  .union([MeetingBriefingFullSchema, MeetingBriefingPlaceholderSchema])
  .describe(
    "v2 artifact schema for the meeting_briefing experiment. Drop into manifest.json's output_schema field at port time.",
  )

export type MeetingBriefing = z.infer<typeof MeetingBriefingSchema>
