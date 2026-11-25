import { describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import type { ToolContext } from '@/agents/tools/tool'
import { actionsDatabricksScope } from './race_opponent_actions.agent'

const service = useTestService()

const SLUG = 'test-org-actions-scope'

const input = (overrides: Record<string, unknown> = {}) => ({
  organizationSlug: SLUG,
  opponents: [
    {
      opponentName: 'Jane Rival',
      threatTier: 'primary_threat',
      overviewText: 'A rival.',
      backgroundText: null,
      issuesThatMatter: ['housing'],
    },
  ],
  raceContext: { city: 'Rockvale', officeName: 'City Council' },
  today: '2026-11-25',
  ...overrides,
})

// The harness resets the database before every test, so the orgs are seeded
// per test rather than once.
const seedOrgs = async () => {
  for (const slug of [SLUG, 'other-org']) {
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
  }
}

const seedRun = async (runInput: unknown, slug = SLUG) =>
  service.prisma.agentRun.create({
    data: {
      agentName: 'race_opponent_actions',
      organizationSlug: slug,
      status: 'running',
      manifest: {},
      shapeHash: 'test',
      input: runInput as never,
    },
  })

const ctx = (runId: string, organizationSlug = SLUG) =>
  ({
    runId,
    stepKey: '0',
    organizationSlug,
    signal: new AbortController().signal,
    get: (type: unknown) => service.app.get(type as never, { strict: false }),
  }) as ToolContext

// The scope is the bound on which voters a run can query, so each branch is a
// limit on what a run may read, not a detail.
describe('actionsDatabricksScope', () => {
  it('reads the run district params into the scope', async () => {
    await seedOrgs()
    const run = await seedRun(
      input({
        state: 'GA',
        l2DistrictType: 'City',
        l2DistrictName: 'ROCKVALE CITY',
      }),
    )

    await expect(actionsDatabricksScope(ctx(run.id))).resolves.toEqual({
      state: 'GA',
      district: { column: 'City', value: 'ROCKVALE CITY' },
    })
  })

  it('scopes to the state alone when the L2 pair is absent', async () => {
    await seedOrgs()
    const run = await seedRun(input({ state: 'GA' }))

    await expect(actionsDatabricksScope(ctx(run.id))).resolves.toEqual({
      state: 'GA',
      district: null,
    })
  })

  // A half pair cannot name a column to prove a clause against, so the run
  // degrades to its state rather than guessing the district.
  it('scopes to the state alone when only half the L2 pair is present', async () => {
    await seedOrgs()
    for (const half of [
      { l2DistrictType: 'City' },
      { l2DistrictName: 'ROCKVALE CITY' },
    ]) {
      const run = await seedRun(input({ state: 'GA', ...half }))

      await expect(actionsDatabricksScope(ctx(run.id))).resolves.toEqual({
        state: 'GA',
        district: null,
      })
    }
  })

  it('refuses a run whose input has no state', async () => {
    await seedOrgs()
    const run = await seedRun(input())

    await expect(actionsDatabricksScope(ctx(run.id))).resolves.toBeNull()
  })

  it('refuses a run whose input does not match the schema', async () => {
    await seedOrgs()
    const run = await seedRun({ organizationSlug: SLUG, opponents: [] })

    await expect(actionsDatabricksScope(ctx(run.id))).resolves.toBeNull()
  })

  it('refuses a run that does not exist', async () => {
    await expect(actionsDatabricksScope(ctx('no-such-run'))).resolves.toBeNull()
  })

  // ctx.organizationSlug is the caller's org for the tool's whole lifetime, so a
  // row owned by another org must not scope a query here.
  it('refuses a run belonging to another organization', async () => {
    await seedOrgs()
    const run = await seedRun(input({ state: 'GA' }), 'other-org')

    await expect(actionsDatabricksScope(ctx(run.id))).resolves.toBeNull()
  })
})
