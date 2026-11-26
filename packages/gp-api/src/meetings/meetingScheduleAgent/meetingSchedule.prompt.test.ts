import { describe, expect, it } from 'vitest'
import { MEETING_SCHEDULE_PROMPT } from './meetingSchedule.prompt'
import { MeetingScheduleOutputSchema } from './meetingSchedule.schema'

// The model copies the prompt's examples and its RRULE table, so an example the
// agent's own schema rejects costs every run that follows it: `submitOutput`
// refuses the artifact and the run spends its turns fixing a sample the prompt
// wrote wrong.
const examples = () =>
  [...MEETING_SCHEDULE_PROMPT.matchAll(/```json\n([\s\S]*?)```/g)].map(
    (match) => JSON.parse(match[1]!) as { status: string },
  )

// Only the reference table, which is the block the model is told to copy. Bare
// fragments elsewhere in the prompt (`FREQ=`, `DTSTART`) are prose about the
// field, not samples. Each row is `| plain English | RRULE |`, so the second
// column is taken whole: matching on a `FREQ=` prefix instead would let a
// mistyped row drop out of the check silently rather than fail it.
const rrules = () =>
  [
    ...MEETING_SCHEDULE_PROMPT.matchAll(/^\s*\|[^|]+\|\s*`([^`]+)`\s*\|\s*$/gm),
  ].map((match) => match[1]!)

const foundArtifact = (rrule: string) => ({
  generated_at: '2026-11-23T00:00:00Z',
  status: 'found',
  meeting_name: 'City Council',
  location: 'City Hall Council Chambers, 200 Main St',
  rrule,
  human: 'Second and fourth Monday of every month',
  time: '19:00',
  timezone: 'America/Chicago',
  duration_minutes: 120,
  sources: [{ url: 'https://example.gov/agendas', note: 'states it' }],
  discovered_schedule_location: null,
})

describe('meeting_schedule prompt', () => {
  it('carries a found example and a not_found example', () => {
    expect(
      examples()
        .map((example) => example.status)
        .sort(),
    ).toEqual(['found', 'not_found'])
  })

  it('writes every example in the shape the agent validates', () => {
    for (const example of examples()) {
      expect(() => MeetingScheduleOutputSchema.parse(example)).not.toThrow()
    }
  })

  it('writes every RRULE in the reference table so the schema accepts it', () => {
    expect(rrules()).toHaveLength(7)
    for (const rrule of rrules()) {
      expect(rrule).toContain('FREQ=')
      expect(rrule).not.toContain('DTSTART')
      expect(
        MeetingScheduleOutputSchema.safeParse(foundArtifact(rrule)).success,
      ).toBe(true)
    }
  })

  // a3-below_threshold: two attempts answered a county sheriff with the county
  // board of commissioners' schedule. The rule those runs missed is that the
  // schedule has to belong to the office's own body, and it has to hold in both
  // directions so the prompt cannot drift into refusing a body the source calls
  // by another name, or into reading a shared building as a shared body.
  it('requires the schedule to belong to the office’s own body', () => {
    const section =
      MEETING_SCHEDULE_PROMPT.split('### Step 2b')[1]!.split('### Step 3')[0]!
    expect(section).toContain('same body, same jurisdiction')
    expect(section).toContain('Never substitute another body')
    expect(section).toContain('A renamed body is the same body')
    expect(section).toContain('A shared room cuts both ways')
  })

  // The fix is general: the office's own page and code decide whether it meets,
  // never a title the prompt blacklists. Naming one makes the same failure come
  // back on the next single-officeholder seat.
  it('does not key the rule to one office title', () => {
    expect(MEETING_SCHEDULE_PROMPT).not.toMatch(/sheriff/i)
  })
})
