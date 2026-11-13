import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { MeetingBriefingSchema } from './meetingBriefing.schema'
import { AgendaSchema, PacketNotesSchema } from './meetingBriefingStages.schema'
import { fullBriefing, placeholder } from './meetingBriefingArtifact.fixture'

const manifest: unknown = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '../../../../runbooks/experiments/meeting_briefing/manifest.json',
    ),
    'utf8',
  ),
)
const outputSchema = z
  .object({ output_schema: z.record(z.string(), z.unknown()) })
  .parse(manifest).output_schema
// The manifest's own JSON Schema, read by Zod's converter, is the reference
// the hand-shaped schema has to agree with.
const manifestSchema = z.fromJSONSchema(outputSchema)
const manifestValidate = (artifact: unknown): boolean =>
  manifestSchema.safeParse(artifact).success

const withItemDisplay = (display: Record<string, unknown>) => ({
  ...fullBriefing,
  items: [
    {
      ...fullBriefing.items[0],
      display: { ...fullBriefing.items[0]?.display, ...display },
    },
  ],
})

const cases: Array<[string, unknown]> = [
  ['a full briefing', fullBriefing],
  ['a placeholder', placeholder],
  [
    'a ready briefing with a placeholder status',
    { ...fullBriefing, briefing_status: 'no_meeting_found' },
  ],
  ['an empty talking point list', withItemDisplay({ talking_points: [] })],
  [
    'two talking points',
    withItemDisplay({
      talking_points: [
        { text: 'a', why: 'b' },
        { text: 'c', why: 'd' },
      ],
    }),
  ],
  [
    'bare-string talking points',
    withItemDisplay({ talking_points: ['a', 'b', 'c'] }),
  ],
  ['an unknown top-level field', { ...fullBriefing, extra: true }],
  [
    'a bad item id',
    { ...fullBriefing, items: [{ ...fullBriefing.items[0], id: 'item_1' }] },
  ],
  [
    'a mean score over 100',
    withItemDisplay({
      constituent_sentiment: {
        summary: 's',
        haystaq_column: 'hs_x',
        mean_score: 101,
        score_direction: 'd',
        voter_count: 1,
        haystaq_status: 'ok',
        source_ids: [],
      },
    }),
  ],
  ['a missing disclosure', { ...fullBriefing, disclosure: undefined }],
  [
    'six executive summary items',
    {
      ...fullBriefing,
      executive_summary: {
        ...fullBriefing.executive_summary,
        items: Array(6).fill(fullBriefing.executive_summary.items[0]),
      },
    },
  ],
]

describe('MeetingBriefingSchema', () => {
  it.each(cases)(
    'agrees with the manifest output_schema on %s',
    (_label, artifact) => {
      const manifestValid = manifestValidate(
        JSON.parse(JSON.stringify(artifact)),
      )
      expect(MeetingBriefingSchema.safeParse(artifact).success).toBe(
        manifestValid,
      )
    },
  )

  // Zod's converter drops `maxItems: 0` on an array with no `items`, so this
  // one is checked against the manifest by reading it rather than by parity.
  it('rejects claims on a placeholder, as the manifest says', () => {
    expect(
      MeetingBriefingSchema.safeParse({
        ...placeholder,
        claims: fullBriefing.claims,
      }).success,
    ).toBe(false)
  })

  it('accepts both the full and the placeholder fixture', () => {
    expect(manifestValidate(fullBriefing)).toBe(true)
    expect(manifestValidate(placeholder)).toBe(true)
  })

  it('converts to JSON Schema for every stage output', () => {
    for (const schema of [
      MeetingBriefingSchema,
      AgendaSchema,
      PacketNotesSchema,
    ]) {
      expect(() => z.toJSONSchema(schema)).not.toThrow()
    }
  })
})
