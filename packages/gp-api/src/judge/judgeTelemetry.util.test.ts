import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JUDGE_ORG_SLUG_PREFIX as RUNNER_PREFIX } from '@/chats/evals/judge/runners/background'
import { JUDGE_FIXTURE } from '@/chats/evals/judge/judgeFixtureIdentity'
import { chatOrgSlug } from '@/chats/evals/judge/runners/seedChatOrg'
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
  JUDGE_FIXTURE_EMAIL,
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

describe('JUDGE_FIXTURE_EMAIL', () => {
  // Copied rather than imported because the guard that reads it ships in the
  // production build and `src/chats/evals/**` does not, so importing the
  // harness there resolves in vitest and then throws MODULE_NOT_FOUND in the
  // container. This test is the only thing keeping the copy honest, and it
  // can import the harness freely because it never ships.
  it('matches the account the judge fixture seeds', () => {
    expect(JUDGE_FIXTURE_EMAIL).toBe(JUDGE_FIXTURE.email)
  })
})

describe('judgeSweepIdFromOrgSlug', () => {
  it('recognises an organization a chat arm actually seeds', () => {
    const slug = chatOrgSlug('chief_of_staff', 'case-1')

    expect(slug.startsWith(JUDGE_ORG_SLUG_PREFIX)).toBe(true)
    expect(judgeSweepIdFromOrgSlug(slug)).toBe(
      slug.slice(JUDGE_ORG_SLUG_PREFIX.length),
    )
  })

  // Documents the gap rather than asserting a sweep id this layer cannot
  // have: chatOrgSlug is a function of the agent and the case only, so the
  // sweep id is nowhere in the slug and nothing here can recover it.
  it('returns a per-case run key, not the sweep id', () => {
    const sweepId = 'swp_1'
    const one = judgeSweepIdFromOrgSlug(chatOrgSlug('chief_of_staff', 'case-1'))
    const two = judgeSweepIdFromOrgSlug(chatOrgSlug('chief_of_staff', 'case-2'))

    expect(one).not.toBe(two)
    expect(one).not.toContain(sweepId)
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
