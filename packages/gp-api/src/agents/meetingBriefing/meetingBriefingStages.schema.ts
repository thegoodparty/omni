import { z } from 'zod'
import { RawContextChunkSchema, SourceSchema } from './meetingBriefing.schema'

export const BriefingInputSchema = z.object({
  organizationSlug: z.string().min(1),
  electedOfficeId: z.string().min(1),
  requestedAt: z.iso.datetime({ offset: true }),
  officialName: z.string().min(1),
  state: z.string().regex(/^[A-Z]{2}$/),
  meetingDate: z.iso.date(),
  meetingTime: z
    .string()
    .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
    .optional(),
  meetingTimezone: z.string().min(1).max(64).optional(),
  positionName: z.string().min(1).optional(),
  l2DistrictType: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)
    .optional(),
  l2DistrictName: z.string().min(1).optional(),
  knownAgendaLocation: z.string().min(1).max(2000).optional(),
  agendaPacketUrl: z
    .string()
    .max(2048)
    .regex(/^https?:\/\//)
    .optional(),
})
export type BriefingInput = z.infer<typeof BriefingInputSchema>

const RunDecisionSchema = z.strictObject({
  timestamp: z.iso.datetime({ offset: true }),
  decision: z.string().min(1),
  reason: z.string().min(1),
})

export const AgendaSchema = z.strictObject({
  found: z
    .boolean()
    .describe(
      'True only when packet content (or a user-supplied agenda) for the target meeting is in hand and readPacket should run.',
    ),
  briefing_status: z
    .enum([
      'agenda_found',
      'agenda_provided_by_user',
      'awaiting_agenda',
      'no_meeting_found',
      'error',
    ])
    .describe(
      'agenda_found or agenda_provided_by_user when found is true; otherwise the placeholder status writeBriefing will emit.',
    ),
  derived_city: z.string(),
  meeting_name: z.string().max(200),
  location: z.string().max(300),
  meeting_time: z.string().regex(/^(([01][0-9]|2[0-3]):[0-5][0-9])?$/),
  meeting_timezone: z.string().max(64),
  agenda_packet_url: z.string().nullable(),
  discovered_agenda_location: z.string().max(2000).nullable(),
  agenda_availability: z.enum([
    'full_packet',
    'html_agenda',
    'partial',
    'not_published',
    'inferred_from_prior',
  ]),
  documents: z
    .array(
      z.strictObject({
        url: z.string().regex(/^https?:\/\//),
        title: z.string().min(1),
        kind: z.enum([
          'compiled_packet',
          'item_attachment',
          'html_agenda',
          'prior_packet',
        ]),
        item_numbers: z.array(z.string()),
      }),
    )
    .describe(
      'Every packet document readPacket must read: the compiled PDF, or each substantive item attachment. An html_agenda page is listed here and its full text is captured in sources.',
    ),
  agenda_items: z
    .array(
      z.strictObject({
        item_number: z.string().nullable(),
        title: z.string().min(1),
        has_packet_document: z.boolean(),
      }),
    )
    .describe('Every item on the target meeting agenda, in agenda order.'),
  sources: z
    .array(SourceSchema)
    .describe(
      'Discovery pages actually fetched (calendar, meeting detail), captured with verbatim snapshots. ids src_disc_001, src_disc_002, ...',
    ),
  run_decisions: z.array(RunDecisionSchema),
})
export type Agenda = z.infer<typeof AgendaSchema>

export const PacketNotesSchema = z.strictObject({
  substantive_items_found: z
    .boolean()
    .describe('Gate B. False routes the briefing to awaiting_agenda.'),
  triage_source: z.enum(['priorities', 'community_issues', 'haystaq']),
  packet_stated_meeting_date: z.iso.date().nullable(),
  packet_date_verification: z.enum(['matched', 'mismatched', 'unavailable']),
  items: z.array(
    z.strictObject({
      id: z.string().regex(/^item_[0-9]{3}$/),
      item_number: z.string().nullable(),
      title: z.string().min(1),
      tier: z.enum(['featured', 'queued', 'standard']),
      vote_required: z.boolean(),
      tier_reason: z.array(z.string().min(1)).min(1),
      priority_id: z.string().nullable(),
      community_issue_id: z.string().nullable(),
      haystaq_column: z
        .string()
        .regex(/^hs_[a-z0-9_]+$/)
        .nullable()
        .describe(
          'The catalog column picked for a featured or queued item, or null when no topic fits.',
        ),
      score_direction: z.string().nullable(),
      packet_notes: z
        .string()
        .min(1)
        .describe(
          'What the item decides, what changes if it passes, what happens if it fails or is deferred, staff recommendation, and gaps in the packet. Facts only, from the packet.',
        ),
      budget_figures: z.array(
        z.strictObject({
          label: z.string().min(1),
          value: z.string().min(1),
          verbatim_extract: z.string().min(1),
          source_id: z.string().min(1),
        }),
      ),
      raw_context: z.array(RawContextChunkSchema).min(1),
    }),
  ),
  sources: z
    .array(SourceSchema)
    .describe(
      'One agenda_packet entry per sub-document read, with the verbatim section text. ids src_pkt_001, src_pkt_002, ...',
    ),
  run_decisions: z.array(RunDecisionSchema),
})
export type PacketNotes = z.infer<typeof PacketNotesSchema>
