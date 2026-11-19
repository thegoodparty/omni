import type { ScoreResponse } from '@/caseScout/schemas/caseScoutModel.schema'
import { CONVERSATION_PREFIX, type BenchFixture } from './fixtures'
import type { BenchModel } from './runner'

// Label-echo stand-ins for the three model calls: each answers with what the
// fixture's own label says should happen. `--stub` runs the whole bench with
// these, for free, to check the plumbing and preview report.html. A stub run
// says nothing about the scout's quality; only a live run does.

const SESSION_HEADER = /^# session (\S+)$/m

export const fixtureIdOf = (transcript: string): string => {
  const sessionId = SESSION_HEADER.exec(transcript)?.[1]
  if (sessionId === undefined) {
    throw new Error('transcript has no session header')
  }
  const [conversationId = ''] = sessionId.split(':')
  return conversationId.slice(CONVERSATION_PREFIX.length)
}

const fixtureFor = (
  transcript: string,
  byId: Map<string, BenchFixture>,
): BenchFixture => {
  const fixture = byId.get(fixtureIdOf(transcript))
  if (!fixture) throw new Error('transcript is not from a bench fixture')
  return fixture
}

export const labelEchoModel = (fixtures: BenchFixture[]): BenchModel => {
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]))
  return {
    scoreTranscript: async (transcript): Promise<ScoreResponse> => {
      const fixture = fixtureFor(transcript, byId)
      const failing =
        fixture.expect.should_draft || fixture.expect.covered_by !== null
      const severity = failing ? 3 : fixture.category === 'borderline' ? 1 : 0
      return {
        session_id: 'stub',
        requests: [
          {
            request_ordinal: 1,
            primary_use_case: 'other',
            answered_request: failing ? 'no' : 'yes',
            overall_rating: failing ? 'bad' : 'good',
            major_failure_type: failing ? 'wrong_or_invented' : 'none',
            known_pattern: fixture.expect.pattern ?? 'none',
            severity,
            confidence: 'high',
            human_review_needed: 'no',
            worth_quoting_anonymized: 'no',
            summary_nonidentifying: 'stub score from the fixture label',
            reason_nonidentifying: 'stub score from the fixture label',
          },
        ],
      }
    },
    draftCase: async (_system, transcript) => {
      const fixture = fixtureFor(transcript, byId)
      if (fixture.expect.covered_by !== null) {
        return JSON.stringify({
          outcome: 'coveredBy',
          failureSummary: `stub ${fixture.id}`,
          caseId: fixture.expect.covered_by,
        })
      }
      return JSON.stringify({
        outcome: 'newCase',
        failureSummary: `stub ${fixture.id}`,
        case: {
          caseId: `bench-stub-${fixture.id}`,
          question: 'A stub question standing in for the drafted one.',
          condition:
            'A stub condition. A live run replaces this with the ' +
            "scout's own draft.",
          handledWhen:
            'the reply does the stub thing; a failing reply does not.',
        },
      })
    },
    secondRead: async () => '[]',
  }
}
