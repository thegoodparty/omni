import { overrideEnvForEvals } from '../chats/evals/envOverride'

// Must run before the app graph constructs LlmService, so the real key from .env
// wins over the .env.test stub.
overrideEnvForEvals()

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ChatScope } from '../generated/prisma'
import { useTestService } from '@/test-service'
import { seedFromFixture } from '../chats/general/ordinance-flow/evals/seedFromFixture'
import type { OrdinanceFixtureName } from '../chats/general/ordinance-flow/evals/fixtures/stepEntry'

/**
 * Produces one ordinance draft for the universal judge.
 *
 * The universal judge compares two variants of an agent, and for a foreground
 * agent the variant is the source tree itself. So the judge checks out each ref
 * and runs this file inside it; what comes back is one JSON file per case.
 *
 * It is a test file because `useTestService()` boots the real app through vitest
 * lifecycle hooks, and driving the agent through its real HTTP route is the only
 * way to exercise the shipped path rather than a reimplementation of it. It never
 * runs in the normal suite or in CI: without UNIVERSAL_JUDGE_CASE set it skips.
 *
 * It reuses the ordinance fixture records and their seeder, which are test data.
 * It deliberately does not touch the cold-judge panel, rubrics, or citation
 * verifier that live beside them — the universal judge does its own grading.
 */
const caseId = process.env.UNIVERSAL_JUDGE_CASE
const outPath = process.env.UNIVERSAL_JUDGE_OUT
// The case names its fixture in params rather than reusing the case id, so case
// ids stay independent of whatever the fixture files happen to be called.
const fixture = process.env.UNIVERSAL_JUDGE_PARAMS
  ? (JSON.parse(process.env.UNIVERSAL_JUDGE_PARAMS)
      .fixture as OrdinanceFixtureName)
  : undefined

const d = caseId && outPath && fixture ? describe : describe.skip

const KICKOFF =
  "Let's begin. Draft the ordinance from what the prior steps settled."

const service = useTestService()

d('universal judge — ordinance draft producer', () => {
  it(`produces a draft for ${caseId}`, async () => {
    const seeded = await seedFromFixture(
      service.prisma,
      service.user.id,
      fixture as OrdinanceFixtureName,
      'draft',
    )
    const headers = {
      headers: { 'X-Organization-Slug': seeded.organizationSlug },
    }

    const created = await service.client.post(
      '/v1/chats',
      {
        scope: ChatScope.ordinance_flow,
        anchor: {
          resourceType: 'ordinance',
          resourceId: seeded.ordinanceId,
          url: `https://goodparty.org/ordinances/${seeded.ordinanceId}`,
          snapshot: { title: 'Universal judge case', summary: caseId },
          step: 'draft',
        },
      },
      headers,
    )
    const conversationId = created.data.conversationId as string

    await service.client.post(
      `/v1/chats/${conversationId}/messages?scope=${ChatScope.ordinance_flow}`,
      { content: KICKOFF },
      headers,
    )

    // Read the persisted row, not the stream: the draft the product ships is
    // what landed in the database, and that is what deserves to be judged.
    const ordinance = await service.prisma.ordinance.findUniqueOrThrow({
      where: { id: seeded.ordinanceId },
    })

    expect(ordinance.draftBody, 'the agent produced no draft body').toBeTruthy()

    writeFileSync(
      ensureDir(outPath as string),
      JSON.stringify(
        {
          output: {
            title: ordinance.draftTitle,
            body: ordinance.draftBody,
            sources: ordinance.draftSources,
          },
        },
        null,
        2,
      ),
    )
  }, 480_000)
})

const ensureDir = (path: string) => {
  mkdirSync(dirname(path), { recursive: true })
  return path
}
