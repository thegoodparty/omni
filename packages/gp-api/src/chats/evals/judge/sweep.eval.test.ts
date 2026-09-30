import { describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import { findAgent } from './agents'
import { loadCaseList } from './cases'
import type { ChatTurnScript } from './runners/chatSeam'
import { ciContextFromEnv, runChatCase } from './runners/chat'
import { seedChatOrg } from './runners/seedChatOrg'
import { captureArm, unjudgeableRecords, type ArmCaseRequest } from './sweepArm'
import { parseArmEnv, storeFromEnv } from './sweepEnv'

// ONE ARM OF ONE SWEEP. Steps 1 and 2 of three: this file runs twice, once in
// the base worktree with JUDGE_ARM=base and once in the candidate worktree
// with JUDGE_ARM=candidate. Step 3, the judging, is `sweep.ts` under tsx.
//
// It has to be vitest and it cannot be tsx: `useTestService()` registers
// beforeAll/beforeEach/afterAll to stand up the Postgres container and the
// authenticated app, and those hooks only exist inside a vitest process. That
// is also why the sweep is configured from the environment — a test file has
// no argv.
//
// Deliberately thin. Everything that could be wrong about walking a case list
// lives in `sweepArm.ts` and is unit-tested there against a fake runner; what
// is left here is the wiring to the real app, which
// `runners/chat.integration.test.ts` covers on its own.

const service = useTestService()

// Absent means nobody asked for a sweep, so the file is skipped and `npm run
// verify` does not try to drive an agent. PRESENT means it runs, and anything
// else missing is fatal with a sentence — see parseArmEnv. A suite that
// self-skipped on a bad value would let the workflow go green having captured
// nothing, which is why the skip is gated on this one variable and not on the
// whole config parsing cleanly.
const sweepRequested = process.env.JUDGE_ARM !== undefined

// Long: one arm of a 3-case, 3-attempt sweep is nine real turns.
const ARM_TIMEOUT_MS = 30 * 60 * 1000

// What the model says when the sweep is not spending. Deterministic on
// purpose: it makes the pipeline exercisable end to end for nothing, which is
// how this runs locally and in any CI job that did not affirmatively opt into
// spend. A canned reply is NOT a verdict about the branch, and the arms'
// config digests still differ, so the judging step's own guards are what stop
// it being read as one.
const dryScriptFor = (request: ArmCaseRequest): ChatTurnScript => ({
  steps: [
    {
      kind: 'text',
      text:
        `[${request.arm}] canned reply for ${request.case.caseId}, attempt ` +
        `${request.attempt}. JUDGE_SPEND was not true, so no model was ` +
        'called.',
    },
  ],
  usage: { inputTokens: 1_000, outputTokens: 100 },
})

describe.skipIf(!sweepRequested)('judge sweep — one arm', () => {
  it(
    'captures this arm of every selected agent and writes its manifest',
    async () => {
      const env = parseArmEnv()
      const store = storeFromEnv(env)
      const ci = ciContextFromEnv()

      const manifest = await captureArm(
        {
          store,
          now: () => new Date(),
          loadCases: loadCaseList,
          runCase: async (request) => {
            if (request.agent.shape !== 'chat') {
              throw new Error(
                `${request.agent.agentId} is a ${request.agent.shape} ` +
                  'agent; captureArm should have skipped it before here',
              )
            }
            if (!('question' in request.case)) {
              throw new Error(
                `${request.case.caseId} carries no question, so it is not ` +
                  'a chat case',
              )
            }
            // Seeded per case AND PER ATTEMPT. `useTestService` resets the
            // database between tests, not between cases, and the whole arm
            // is one test — so a slug keyed on the case id alone collides on
            // the second attempt with a unique-constraint failure on
            // `organization.slug`.
            //
            // Still derived rather than randomised, which is the property
            // seedChatOrg asks for: attempt i of both arms gets the same
            // slug, so two arms that changed nothing the agent can see still
            // render the same system prompt and the identical-config refusal
            // stays armed.
            const seeded = await seedChatOrg(
              service.prisma,
              service.user.id,
              request.agent.agentId,
              `${request.case.caseId}-${request.attempt}`,
            )
            return runChatCase(
              { service },
              {
                agentId: request.agent.agentId,
                case: request.case,
                sweepId: request.sweepId,
                arm: request.arm,
                attempt: request.attempt,
                variant: {
                  ...request.variant,
                  // Replaced by whatever actually answered; this is only
                  // what the scope's chain is expected to reach.
                  model: 'claude-sonnet-4-6',
                },
                organizationSlug: seeded.organizationSlug,
                ...(seeded.anchor && { anchor: seeded.anchor }),
                ...(request.spends ? {} : { script: dryScriptFor(request) }),
                ...(env.dataVersion !== undefined && {
                  dataVersion: env.dataVersion,
                }),
                ...(ci && { ci }),
              },
            )
          },
        },
        env,
      )

      // WHAT THIS SUITE HAS TO CATCH, and what an earlier version of it could
      // not. This is the only process that drives the real app and the only
      // one that spends, so the failure it must not go green on is "captured
      // nothing". Several plausible assertions cannot catch that:
      //
      //   - `agents.length + skipped.length > 0` is enforced by
      //     ArmManifestSchema's own refine, which putManifest runs before
      //     captureArm returns, so it can never be false here.
      //   - `arm`, `sweepId` on a record are enforced by
      //     assertAnswersRequest before the write.
      //   - `recordsWritten === cases * attempts` is the walk's own loop
      //     bounds, and is vacuous when nothing was captured.
      //
      // So the assertions below are derived from the REQUEST instead: every
      // agent this arm was asked for has to be accounted for, and every one
      // that could have been captured has to have been.
      const requested = [...env.agentIds].sort()
      const accounted = [
        ...manifest.agents.map((a) => a.agentId),
        ...manifest.skipped.map((s) => s.agentId),
      ].sort()
      // No agent silently dropped between the selection and the manifest.
      expect(accounted).toEqual(requested)

      // Every chat agent with a case list must actually have been captured.
      // A skip here means paid work that did not happen, and the reason is in
      // the manifest — this assertion is what turns that into a red job
      // rather than a quiet coverage gap.
      const capturable = requested.filter((id) => {
        const entry = findAgent(id)
        return (
          entry?.shape === 'chat' &&
          entry.cases !== null &&
          entry.status !== 'blocked'
        )
      })
      expect(
        manifest.agents.map((a) => a.agentId).sort(),
        `skipped: ${JSON.stringify(manifest.skipped)}`,
      ).toEqual(capturable)

      // Read back through the store rather than trusted from the manifest's
      // own count: the manifest says what the capture believed it wrote, and
      // this is the only check that the OTHER arm's process will find it.
      const written = await store.listRecords(env.sweepId, env.arm)
      expect(written.length).toBe(
        manifest.agents.reduce((sum, a) => sum + a.recordsWritten, 0),
      )
      if (capturable.length > 0) expect(written.length).toBeGreaterThan(0)

      // Judgeable records, held to the standard the path deserves: every one
      // of them under the canned script, where an infraError is a harness
      // bug; only "not all of them" under real spend, where one flaky turn is
      // a reported exclusion everywhere else in the pipeline and must not
      // throw away a paid sweep. See unjudgeableRecords.
      expect(unjudgeableRecords(written, env.spends)).toEqual([])

      // Exactly the keys the other arm will look under, one per case and
      // attempt, with nothing missing and nothing doubled.
      for (const agent of manifest.agents) {
        const mine = written.filter((r) => r.agentId === agent.agentId)
        expect(new Set(mine.map((r) => r.runId)).size).toBe(
          agent.cases * agent.attempts,
        )
      }
    },
    ARM_TIMEOUT_MS,
  )
})
