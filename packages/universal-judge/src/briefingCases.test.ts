import { describe, expect, it } from 'vitest'
import { loadCases } from './cases.js'

/**
 * The failure this guards against is silent, which is what makes it dangerous.
 *
 * A meeting_briefing case naming a future date stops working the moment that date
 * passes: the agent finds no meeting, both variants correctly report none, every
 * pair ties, and the comparison reports a healthy-looking "no material change"
 * while measuring nothing at all. Pinning each case to a past meeting and the
 * permanent agenda URL that run used makes it reproducible forever.
 */
describe('meeting_briefing cases', () => {
  const cases = loadCases('meeting_briefing')

  it('pins every case to a meeting that has already happened', () => {
    for (const testCase of cases) {
      const date = new Date(
        `${testCase.params.meetingDate as string}T00:00:00Z`,
      )
      expect(
        date.getTime(),
        `${testCase.id} names ${testCase.params.meetingDate}, which is not in the past`,
      ).toBeLessThan(Date.now())
    }
  })

  it('supplies a permanent agenda URL so both variants read the same document', () => {
    for (const testCase of cases) {
      const url = testCase.params.agendaPacketUrl as string
      expect(url, `${testCase.id} has no agendaPacketUrl`).toBeTruthy()
      expect(url, `${testCase.id} has a non-http agendaPacketUrl`).toMatch(
        /^https?:\/\//,
      )
      // A presigned S3 link expires, which is the same rot in a different shape.
      expect(url, `${testCase.id} uses a presigned URL`).not.toMatch(
        /X-Amz-Signature/i,
      )
    }
  })

  it('carries the fields the agent needs to identify the meeting', () => {
    for (const testCase of cases) {
      for (const field of ['officialName', 'state', 'positionName']) {
        expect(
          testCase.params[field],
          `${testCase.id} is missing ${field}`,
        ).toBeTruthy()
      }
      expect(testCase.params.state, `${testCase.id} has a bad state`).toMatch(
        /^[A-Z]{2}$/,
      )
    }
  })

  it('spans more than one jurisdiction and body type', () => {
    // A set that is all big-city councils would miss the small-town degradation
    // that is the whole reason these agents are hard.
    const states = new Set(cases.map((c) => c.params.state))
    const bodies = new Set(
      cases.map((c) =>
        (c.params.positionName as string).split(' ').slice(1).join(' '),
      ),
    )
    expect(states.size).toBeGreaterThan(3)
    expect(bodies.size).toBeGreaterThan(2)
  })

  it('has enough cases to clear the power floor', () => {
    expect(cases.length).toBeGreaterThanOrEqual(6)
  })
})
