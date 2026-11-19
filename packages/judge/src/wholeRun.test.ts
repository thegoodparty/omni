import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { MockLanguageModelV3 } from 'ai/test'
import { afterEach, describe, expect, it } from 'vitest'
import { executeSuite } from './execute'
import { createGrader } from './grade'
import { definePairwiseAgentEvalSuite } from './suite'
import { renderMarkdown, verdictFor, writeResults } from './report'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The whole run against two real HTTP arms and the real generateObject, with
// only the model faked. This is the test that would notice a break in the wiring
// between provisioning, the two routes, the grading call and the report.

type Arm = { server: Server; baseUrl: string; closed: () => Promise<void> }

const startArm = async (artifactText: string): Promise<Arm> => {
  const server = createServer((request, response) => {
    request.on('data', () => {})
    request.on('end', () => {
      const json = (body: unknown) =>
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify(body))
      if (request.url === '/') return json({ ok: true })
      if (
        request.method === 'POST' &&
        request.url === '/api/v1/agents/a/runs'
      ) {
        return json({ runId: 'run-1' })
      }
      if (request.url === '/api/v1/agents/runs/run-1') {
        return json({ status: 'completed', artifact: { text: artifactText } })
      }
      response.writeHead(404).end('nope')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    closed: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

const arms: Arm[] = []

afterEach(async () => {
  await Promise.all(arms.splice(0).map((arm) => arm.closed()))
})

const graderFor = () => {
  // Prefers whichever text it is shown as A, whatever that text is: exactly the
  // position bias the two-order call exists to cancel.
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            // Preferred the output it read first, whatever that output was.
            winner: 'A',
            reasoning: 'Preferred the first output it read.',
            handledWhen: { A: 'yes', B: 'yes' },
            // Every question the case asks: the three defaults, plus the case's
            // own `sourcing`.
            dimensions: [
              'task_success',
              'instruction_adherence',
              'user_utility',
              'sourcing',
            ].map((name) => ({ name, A: 4, B: 4 })),
          }),
        },
      ],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 30, noCache: 30, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 10, text: 10, reasoning: 0 },
      },
      warnings: [],
    }),
  })
  return createGrader({ model })
}

const suite = definePairwiseAgentEvalSuite<{ organizationSlug: string }>(
  'smoke',
  {
    mode: 'win',
    profile: {},
    run: async (input, ctx) => {
      const run = await ctx.runAgent('a', input)
      return JSON.stringify(run.artifact)
    },
    cases: [
      {
        id: 'case-1',
        input: { organizationSlug: 'ctx-wins' },
        grading: {
          condition: 'a plain case',
          handledWhen: 'the output parses',
          dimensions: { sourcing: 'Are the sources dated?' },
        },
      },
    ],
  },
)

describe('a whole run', () => {
  it('grades every pair in both orders and writes both artifacts', async () => {
    const base = await startArm('output from base')
    const candidate = await startArm('output from candidate')
    arms.push(base, candidate)

    const result = await executeSuite({
      suite: suite as never,
      baseUrl: base.baseUrl,
      candidateUrl: candidate.baseUrl,
      grader: graderFor(),
      concurrency: 6,
      // The test user would otherwise be a real Clerk identity; the arms are
      // real, so only provisioning is faked.
      createArmContextFn: (async (options: {
        arm: 'base' | 'candidate'
        baseUrl: string
      }) => {
        const { createArmContext } = await import('./arm')
        return createArmContext({
          ...options,
          mode: 'win',
          profile: {},
          provisionUser: async () => ({
            user: {
              id: 1,
              firstName: 'T',
              lastName: 'U',
              email: 'test+clerk_test@test.goodparty.org',
              name: 'T U',
              zip: '82001',
              phone: '2015550100',
              password: 'p',
            },
            token: 'tok',
            client: (await import('axios')).default.create({
              baseURL: `${options.baseUrl}/api`,
              headers: { common: { Authorization: 'Bearer tok' } },
            }),
            clerkUserId: 'clerk-1',
            orgSlug: `org-${options.arm}`,
          }),
          pollIntervalMs: 1,
        })
      }) as never,
    })

    expect(result.cases[0]!.pairs).toHaveLength(3)
    for (const pair of result.cases[0]!.pairs) {
      expect(pair.orders).toHaveLength(2)
      expect(pair.orders[0]!.aArm).toBe('base')
      expect(pair.orders[1]!.aArm).toBe('candidate')
      // The model preferred its slot both times, so the pair is a tie.
      expect(pair.winner).toBe('tie')
      // Both the suite's own dimension and the defaults were scored.
      expect(Object.keys(pair.scores).sort()).toEqual([
        'instruction_adherence',
        'sourcing',
        'task_success',
        'user_utility',
      ])
      expect(pair.handled).toEqual({ base: true, candidate: true })
      expect(pair.usage).toEqual({ inputTokens: 60, outputTokens: 20 })
    }

    const verdict = verdictFor(result)
    expect(verdict.label).toBe('NO DIFFERENCE FOUND')

    const outDir = await mkdtemp(join(tmpdir(), 'judge-e2e-'))
    const { jsonPath, markdownPath } = await writeResults(outDir, {
      baseUrl: base.baseUrl,
      candidateUrl: candidate.baseUrl,
      judgeModel: 'anthropic/claude-sonnet-4-6',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:01:00.000Z',
      attemptsPerSide: 3,
      suites: [{ result, verdict }],
    })
    const markdown = renderMarkdown({
      baseUrl: base.baseUrl,
      candidateUrl: candidate.baseUrl,
      judgeModel: 'anthropic/claude-sonnet-4-6',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:01:00.000Z',
      attemptsPerSide: 3,
      suites: [{ result, verdict }],
    })
    expect(jsonPath.endsWith('results.json')).toBe(true)
    expect(markdownPath.endsWith('results.md')).toBe(true)
    expect(markdown).toContain('## smoke: NO DIFFERENCE FOUND')
  })
})
