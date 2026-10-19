import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JUDGE_ORG_SLUG_PREFIX as RUNNER_PREFIX } from '@/chats/evals/judge/runners/background'
import { JUDGE_FIXTURE } from '@/chats/evals/judge/judgeFixtureIdentity'
import { JUDGE_CLERK_EMAIL } from '@/chats/evals/judge/judgeClerkSession'
import { chatOrgSlug } from '@/testFixtures/judgeChatFixture/seed'
import type { TurnToolEvent } from '@/chats/services/chatStream.service'

// The real derivation, driven by a stubbed OTEL_SERVICE_ENVIRONMENT, so these
// assertions are about the fail-closed allowlist and not about a boolean the
// test set itself.
const { otel } = vi.hoisted(() => ({
  otel: { value: undefined as string | undefined },
}))
vi.mock('@/shared/util/appEnvironment.util', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/shared/util/appEnvironment.util')>()
  return {
    ...actual,
    get IS_NON_PROD_DEPLOY() {
      return actual.isNonProdDeploy(otel.value)
    },
  }
})

import {
  hashPrompt,
  judgeSweepIdFromOrgSlug,
  judgeToolNames,
  judgeToolQueries,
  judgeToolSteps,
  JUDGE_CHAT_EMAIL,
  JUDGE_ORG_SLUG_PREFIX,
  PROMPT_HASH_VERSION,
} from './judgeTelemetry.util'

beforeEach(() => {
  otel.value = 'dev'
})

describe('JUDGE_ORG_SLUG_PREFIX', () => {
  // The local copy exists so a chat turn does not import the eval harness.
  // If the sweep runner ever renames its prefix, every judge conversation
  // would stop being recognised silently, so fail here instead.
  it('matches the prefix the sweep runner dispatches on', () => {
    expect(JUDGE_ORG_SLUG_PREFIX).toBe(RUNNER_PREFIX)
  })
})

describe('JUDGE_CHAT_EMAIL', () => {
  // The chat judge and the background fixture are DIFFERENT accounts, and
  // this test exists to stop them being merged again. judgeFixtureSeed.ts
  // seeds a gp-api user holding JUDGE_FIXTURE.email under a placeholder
  // clerk id, for agents that authenticate with a broker token and never
  // reach Clerk. `User.email` is unique, so a real Clerk account under that
  // same address cannot be provisioned and every chat request 401s.
  it('is not the background fixture address', () => {
    expect(JUDGE_CHAT_EMAIL).not.toBe(JUDGE_FIXTURE.email)
  })

  it('is the address the Clerk helper provisions', () => {
    expect(JUDGE_CLERK_EMAIL).toBe(JUDGE_CHAT_EMAIL)
  })
})

const SWEEP = 'judge-19284756312-1'

describe('judgeSweepIdFromOrgSlug', () => {
  it('recognises an organization a chat arm actually seeds', () => {
    const slug = chatOrgSlug(SWEEP, 'chief_of_staff', 'case-1')

    expect(slug.startsWith(JUDGE_ORG_SLUG_PREFIX)).toBe(true)
    expect(judgeSweepIdFromOrgSlug(slug)).toBe(
      slug.slice(JUDGE_ORG_SLUG_PREFIX.length),
    )
  })

  // The column's value is the sweep id followed by the case's own key, which
  // is what makes it groupable by sweep with a prefix match while staying
  // unique per case. Both halves are asserted, because a value that lost
  // either one would break a different reader.
  it('is sweep-id-prefixed and still unique per case', () => {
    const one = judgeSweepIdFromOrgSlug(
      chatOrgSlug(SWEEP, 'chief_of_staff', 'case-1'),
    )
    const two = judgeSweepIdFromOrgSlug(
      chatOrgSlug(SWEEP, 'chief_of_staff', 'case-2'),
    )

    expect(one).not.toBe(two)
    expect(one?.startsWith('19284756312-1-')).toBe(true)
    expect(two?.startsWith('19284756312-1-')).toBe(true)
  })

  // Two sweeps are told apart by that prefix, which is the grouping the
  // column's name promises.
  it('separates two sweeps running the same case', () => {
    const one = judgeSweepIdFromOrgSlug(
      chatOrgSlug('judge-19284756312-1', 'chief_of_staff', 'case-1'),
    )
    const two = judgeSweepIdFromOrgSlug(
      chatOrgSlug('judge-19284756312-2', 'chief_of_staff', 'case-1'),
    )

    expect(one).not.toBe(two)
    expect(two?.startsWith('19284756312-1-')).toBe(false)
  })

  it('is null for an organization a real official owns', () => {
    expect(judgeSweepIdFromOrgSlug('springfield-city-council')).toBeNull()
  })

  it('is null for a conversation with no organization', () => {
    expect(judgeSweepIdFromOrgSlug(null)).toBeNull()
  })

  it.each([
    ['prod', 'prod'],
    ['absent', undefined],
    ['a typo', 'develop'],
    ['production, which is not in the allowlist', 'production'],
  ])('is null on %s, so prod never records', (_label, value) => {
    otel.value = value

    expect(judgeSweepIdFromOrgSlug('judge-anything')).toBeNull()
  })

  it('records on preview as well as dev', () => {
    otel.value = 'preview'

    expect(judgeSweepIdFromOrgSlug('judge-anything')).toBe('anything')
  })
})

describe('hashPrompt', () => {
  it('is stable and version-tagged', () => {
    expect(hashPrompt('a prompt')).toBe(hashPrompt('a prompt'))
    expect(hashPrompt('a prompt')).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(PROMPT_HASH_VERSION).toBeTruthy()
  })

  it('differs on a prompt the model would have seen differently', () => {
    expect(hashPrompt('a prompt')).not.toBe(hashPrompt('a prompt '))
  })
})

const call = (
  toolCallId: string,
  name: string,
  args: Record<string, unknown> = {},
): TurnToolEvent => ({ toolCallId, name, args, status: 'returned', result: {} })

describe('judgeToolNames', () => {
  it('sorts and deduplicates, so call order cannot forge a difference', () => {
    const events = [call('1', 'zeta'), call('2', 'alpha'), call('3', 'zeta')]

    expect(judgeToolNames(events)).toEqual(['alpha', 'zeta'])
  })

  it('ignores an unpaired result, which is not a call', () => {
    const events: TurnToolEvent[] = [
      call('1', 'alpha'),
      { toolCallId: 'ghost', name: 'zeta', status: 'unpaired', result: {} },
    ]

    expect(judgeToolNames(events)).toEqual(['alpha'])
  })
})

describe('judgeToolSteps', () => {
  it('keeps call order and tells two calls to one tool apart', () => {
    const events = [call('a', 'search'), call('b', 'search')]

    expect(judgeToolSteps(events)).toEqual([
      { toolCallId: 'a', name: 'search' },
      { toolCallId: 'b', name: 'search' },
    ])
  })

  // A tool result can carry constituent data, which the turn holds in memory
  // and never persists. Nothing from args or result may reach a step.
  it('carries neither arguments nor results', () => {
    const steps = judgeToolSteps([
      {
        toolCallId: 'a',
        name: 'query_constituent_data',
        args: { sql: 'SELECT 1', secret: 'x' },
        status: 'returned',
        result: { rows: [{ name: 'a real person' }] },
      },
    ])

    expect(JSON.stringify(steps)).not.toContain('a real person')
    expect(steps).toEqual([{ toolCallId: 'a', name: 'query_constituent_data' }])
  })

  it('records a failed call, since the call still ran', () => {
    const events: TurnToolEvent[] = [
      { toolCallId: 'a', name: 'boom', args: {}, status: 'failed', error: 'e' },
    ]

    expect(judgeToolSteps(events)).toEqual([{ toolCallId: 'a', name: 'boom' }])
  })
})

describe('judgeToolQueries', () => {
  it('collects the agent-written SQL from the tool arguments, in order', () => {
    const events = [
      call('a', 'query_constituent_data', { sql: 'SELECT 1' }),
      call('b', 'present_card', { title: 'no sql here' }),
      call('c', 'district_insights', { sql: 'SELECT 2' }),
    ]

    expect(judgeToolQueries(events)).toEqual(['SELECT 1', 'SELECT 2'])
  })

  it('is empty for a turn that queried nothing', () => {
    expect(judgeToolQueries([call('a', 'present_card')])).toEqual([])
  })
})
