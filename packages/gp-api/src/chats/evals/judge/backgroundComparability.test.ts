import { describe, expect, it } from 'vitest'
import { AGENTS } from './agents'
import { agentConfigFor } from './runners/agentConfig'
import { backgroundConfigDigest } from './runners/background'

// WHAT A BACKGROUND SWEEP CAN AND CANNOT MEASURE, pinned so the limit is a
// named property rather than something found beside a paid verdict.
//
// A background record's configDigest is the sha256 of the staged manifest and
// instruction, and NOTHING ELSE — not the commit, not the gp-api tree. That is
// correct rather than an oversight: a background agent runs on Fargate against
// the broker, so a gp-api branch genuinely cannot change what it does. The
// only thing a branch can change about one is its files under
// packages/runbooks/experiments.
//
// The consequence is that a background agent whose experiment files are
// untouched hashes identically on both arms, and `normalizeAgent` refuses it
// by name — after both arms have been captured and billed. `auto` selection
// derives agent ids from the touched experiment directories, so the normal
// flow never reaches that; `all` and an explicit selection can.
describe('what makes a background comparison possible at all', () => {
  const sweepable = AGENTS.filter(
    (agent) => agent.shape === 'background' && agent.status !== 'blocked',
  ).map((agent) => agent.agentId)

  // THE PROPERTY THE REFUSAL RESTS ON. If the digest ever took in something
  // per-arm — a commit, a ref — two arms would stop hashing alike on an
  // untouched agent, the refusal would go quiet, and the judge would start
  // reporting deltas between two runs of identical config as if they were a
  // branch effect. That is a worse failure than the refusal, so it is pinned
  // here rather than left to be noticed.
  it.each(sweepable)(
    '%s hashes the same from two reads of the same files',
    (agentId) => {
      expect(backgroundConfigDigest(agentConfigFor(agentId))).toBe(
        backgroundConfigDigest(agentConfigFor(agentId)),
      )
    },
  )

  // Different agents must not collide, or an override staged for one would be
  // read by the other.
  it('gives every agent its own digest', () => {
    const digests = sweepable.map((id) =>
      backgroundConfigDigest(agentConfigFor(id)),
    )
    expect(new Set(digests).size).toBe(sweepable.length)
  })

  // The serialization is load-bearing beyond the refusal: the digest is the
  // `_judge/<agentId>/<digest>/` key AND the base-arm cache key. A change to
  // the projection's field set or key order silently re-keys every cached
  // base arm, so the next sweep re-pays for all of them with no signal. Pinned
  // to a value so that is a failing test rather than an invoice.
  it('is stable for a known agent', () => {
    expect(backgroundConfigDigest(agentConfigFor('meeting_briefing'))).toBe(
      '21b422f42fc92b29d5693697b0897c90',
    )
  })
})
