import { describe, expect, it } from 'vitest'
import {
  EXPLICIT_SELECTION,
  SELECTION_ENV,
  SweepEnvError,
  parseArmEnv,
  parseSweepEnv,
  variantFor,
} from './sweepEnv'
import { SPEND_ENV, SPEND_VALUE, spendsRealMoney } from './config'
import { JUDGE_FIXTURE_ENV_NAMES } from './caseParams'
import { armEnvFor as armEnv } from './fixtures/sweep'

describe('parseArmEnv', () => {
  it('reads a complete arm environment', () => {
    const env = parseArmEnv(armEnv())
    expect(env.arm).toBe('candidate')
    expect(env.sweepId).toBe('swp_1')
    expect(env.agentIds).toEqual(['chief_of_staff'])
    expect(env.recordsDir).toBe('/tmp/judge')
  })

  it('splits and trims a comma-separated agent list', () => {
    expect(
      parseArmEnv(armEnv({ JUDGE_AGENTS: 'chief_of_staff, priority_flow ' }))
        .agentIds,
    ).toEqual(['chief_of_staff', 'priority_flow'])
  })

  // A repeated id would be swept twice and billed twice, and the second pass
  // overwrites the first's records at the same keys — paid double, reported
  // single. `parseAgentSelector` dedupes the CLI's list for the same reason.
  it('dedupes the agent list', () => {
    expect(
      parseArmEnv(
        armEnv({ JUDGE_AGENTS: 'chief_of_staff,priority_flow,chief_of_staff' }),
      ).agentIds,
    ).toEqual(['chief_of_staff', 'priority_flow'])
  })

  // A sweep that dies several frames deep on an undefined has already spent
  // money. Every missing value is named instead.
  it.each([
    'JUDGE_SWEEP_ID',
    'JUDGE_AGENTS',
    'JUDGE_BASE_REF',
    'JUDGE_CANDIDATE_SHA',
    'JUDGE_ARM_COMMIT',
  ])('names %s when it is missing', (name) => {
    const env = armEnv()
    delete env[name]
    expect(() => parseArmEnv(env)).toThrow(
      new RegExp(`cannot capture an arm: ${name} is not set`),
    )
  })

  it('names every missing value, not only the first', () => {
    const env = armEnv()
    delete env.JUDGE_BASE_REF
    delete env.JUDGE_ARM_COMMIT
    const message = (() => {
      try {
        parseArmEnv(env)
        return ''
      } catch (err) {
        return err instanceof Error ? err.message : ''
      }
    })()
    expect(message).toContain('JUDGE_BASE_REF is not set')
    expect(message).toContain('JUDGE_ARM_COMMIT is not set')
  })

  // An empty string is a value the workflow can hand over, and treating it as
  // present would make the sweep write records under an empty sweep id.
  it('treats an empty value as unset rather than as a value', () => {
    expect(() => parseArmEnv(armEnv({ JUDGE_SWEEP_ID: '   ' }))).toThrow(
      /JUDGE_SWEEP_ID is not set/,
    )
  })

  it('distinguishes a malformed value from a missing one', () => {
    expect(() => parseArmEnv(armEnv({ JUDGE_SWEEP_ID: 'has/slash' }))).toThrow(
      /JUDGE_SWEEP_ID names a directory/,
    )
  })

  it('rejects an arm that is neither base nor candidate', () => {
    expect(() => parseArmEnv(armEnv({ JUDGE_ARM: 'both' }))).toThrow(
      SweepEnvError,
    )
  })

  // The candidate arm's commit is known twice, and a disagreement means the
  // checkout is not the commit the plan priced — invisible in the records,
  // because both values look like commits.
  it('refuses a candidate checkout that is not the planned commit', () => {
    expect(() =>
      parseArmEnv(armEnv({ JUDGE_ARM_COMMIT: 'b'.repeat(40) })),
    ).toThrow(/is not the commit under test/)
  })

  // The base arm runs in a worktree at the base ref, so its HEAD is expected
  // to differ from the candidate SHA. Applying the check to both arms would
  // make the base arm impossible to run.
  it('allows the base arm to be at a different commit', () => {
    const env = parseArmEnv(
      armEnv({ JUDGE_ARM: 'base', JUDGE_ARM_COMMIT: 'b'.repeat(40) }),
    )
    expect(env.armCommit).toBe('b'.repeat(40))
  })

  // Affirmative, like the workflow's own `live` switch: anything that is not
  // exactly 'true' plans rather than spends.
  it.each([undefined, '', 'TRUE', '1', 'yes', 'false'])(
    'does not spend on JUDGE_SPEND=%o',
    (value) => {
      expect(
        parseArmEnv(armEnv(value === undefined ? {} : { JUDGE_SPEND: value }))
          .spends,
      ).toBe(false)
    },
  )

  it('spends only on the exact string true', () => {
    expect(parseArmEnv(armEnv({ JUDGE_SPEND: 'true' })).spends).toBe(true)
  })

  it('requires somewhere to put records', () => {
    const env = armEnv()
    delete env.JUDGE_RECORDS_DIR
    expect(() => parseArmEnv(env)).toThrow(/has nowhere to put records/)
  })

  // Two stores and no rule for which wins is how the two arms end up writing
  // to different places and never meeting.
  it('refuses both a directory and a bucket', () => {
    expect(() =>
      parseArmEnv(armEnv({ JUDGE_RECORDS_BUCKET: 'gp-agent-artifacts-dev' })),
    ).toThrow(/set exactly one/)
  })

  it('carries the pinned Delta version through', () => {
    expect(parseArmEnv(armEnv({ JUDGE_DATA_VERSION: '412' })).dataVersion).toBe(
      '412',
    )
  })

  // THE UNPINNED PATH, and it arrives as an EMPTY STRING rather than as an
  // absent variable: the workflow builds this entry from a step output that is
  // empty when the mart could not be read, and Actions still exports it.
  // Reading blank as malformed would refuse the whole arm and kill a paid
  // sweep over a table most agents never query — which is the opposite of the
  // policy the empty output implements.
  it('reads an empty Delta version as not pinned rather than refusing', () => {
    expect(
      parseArmEnv(armEnv({ JUDGE_DATA_VERSION: '' })).dataVersion,
    ).toBeUndefined()
  })

  it('reads a whitespace-only Delta version as not pinned', () => {
    expect(
      parseArmEnv(armEnv({ JUDGE_DATA_VERSION: '  ' })).dataVersion,
    ).toBeUndefined()
  })

  // WHO ASKED FOR THESE AGENTS, which is what decides whether the sameness
  // refusals are armed. Pinned to the one word rather than to anything truthy,
  // for the reason the spend switch is: the cost of reading `auto` as
  // `explicit` is a verdict about two things nothing proved were different.
  it('reads a named selection as explicit', () => {
    expect(
      parseArmEnv(armEnv({ [SELECTION_ENV]: EXPLICIT_SELECTION }))
        .explicitSelection,
    ).toBe(true)
  })

  // AND A BLANK VALUE MUST NOT REFUSE THE ARM. Same shape as the Delta
  // version above and for the same reason: Actions exports every `env:` entry
  // a job declares, including one built from a step output that wrote nothing,
  // so this arrives as an empty string rather than as an absent variable.
  // `NON_EMPTY.optional()` here would kill a paid capture over it.
  it.each([undefined, '', '   ', 'auto', 'EXPLICIT', 'true', 'yes'])(
    'leaves the refusals armed on JUDGE_SELECTION=%o',
    (value) => {
      expect(
        parseArmEnv(
          armEnv(value === undefined ? {} : { [SELECTION_ENV]: value }),
        ).explicitSelection,
      ).toBe(false)
    },
  )

  // The fixture identifiers a background case's `{judge…}` tokens are
  // substituted with. Same thread as the Delta version, keyed off the same
  // constant the exporting half builds from, so a rename cannot leave an arm
  // reading a variable nobody sets.
  it('carries the fixture identifiers through', () => {
    expect(
      parseArmEnv(
        armEnv({
          [JUDGE_FIXTURE_ENV_NAMES.orgSlug]: 'eo-abc',
          [JUDGE_FIXTURE_ENV_NAMES.raceId]: 'race-1',
          [JUDGE_FIXTURE_ENV_NAMES.userEmail]: 'qa-1@goodparty.org',
        }),
      ).fixtureValues,
    ).toEqual({
      orgSlug: 'eo-abc',
      raceId: 'race-1',
      userEmail: 'qa-1@goodparty.org',
    })
  })

  // Most sweeps mint no fixture: nine of the fifteen background lists carry
  // plain data and every chat list does. An empty object, not a refusal.
  it('reads an unminted fixture as no values at all', () => {
    expect(parseArmEnv(armEnv()).fixtureValues).toEqual({})
  })

  // THE SAME EMPTY-STRING TRAP the Delta version has, with a sharper edge:
  // Actions exports an `env:` entry built from an empty step output, and `''`
  // would not merely be accepted here — it would SUBSTITUTE, dispatching
  // `organization_slug: ''`, which the agent's own minLength refuses twenty
  // minutes in. Read as not supplied, `assertNoPlaceholders` names the token
  // before anything is sent.
  it.each(['', '   '])(
    'reads a blank fixture identifier as not supplied (%j)',
    (blank) => {
      expect(
        parseArmEnv(
          armEnv({
            [JUDGE_FIXTURE_ENV_NAMES.orgSlug]: blank,
            [JUDGE_FIXTURE_ENV_NAMES.raceId]: 'race-1',
          }),
        ).fixtureValues,
      ).toEqual({ raceId: 'race-1' })
    },
  )

  it('trims a fixture identifier rather than carrying the padding', () => {
    expect(
      parseArmEnv(armEnv({ [JUDGE_FIXTURE_ENV_NAMES.orgSlug]: '  eo-abc  ' }))
        .fixtureValues,
    ).toEqual({ orgSlug: 'eo-abc' })
  })

  it('reads a PR number when there is one', () => {
    expect(parseArmEnv(armEnv({ JUDGE_PR_NUMBER: '2240' })).prNumber).toBe(2240)
  })
})

describe('variantFor', () => {
  it('names the base ref on the base arm', () => {
    const env = parseArmEnv(
      armEnv({ JUDGE_ARM: 'base', JUDGE_ARM_COMMIT: 'b'.repeat(40) }),
    )
    expect(variantFor(env)).toEqual({
      ref: 'universal-judge',
      commit: 'b'.repeat(40),
    })
  })

  it('names the head ref on the candidate arm when it has one', () => {
    const env = parseArmEnv(
      armEnv({ JUDGE_CANDIDATE_REF: 'judge-track-orchestrator' }),
    )
    expect(variantFor(env).ref).toBe('judge-track-orchestrator')
  })

  // Falling back to the base ref would make the two arms indistinguishable in
  // the one field meant to tell them apart.
  it('falls back to the commit, never to the base ref', () => {
    const ref = variantFor(parseArmEnv(armEnv())).ref
    expect(ref).toBe(`candidate@${'a'.repeat(12)}`)
    expect(ref).not.toBe('universal-judge')
  })
})

describe('parseSweepEnv', () => {
  // THE JUDGING ENTRY SPENDS TOO — one panel call per judgeable pair, per
  // seat. A switch that gated only the arms made "exercise the pipeline for
  // nothing" a false claim, and it was one.
  it.each([undefined, '', 'TRUE', '1', 'false'])(
    'does not spend on JUDGE_SPEND=%o',
    (value) => {
      expect(
        parseSweepEnv({
          JUDGE_SWEEP_ID: 'swp_1',
          JUDGE_AGENTS: 'chief_of_staff',
          JUDGE_RECORDS_DIR: '/tmp/judge',
          ...(value === undefined ? {} : { JUDGE_SPEND: value }),
        }).spends,
      ).toBe(false)
    },
  )

  it('spends only on the exact string true', () => {
    expect(
      parseSweepEnv({
        JUDGE_SWEEP_ID: 'swp_1',
        JUDGE_AGENTS: 'chief_of_staff',
        JUDGE_RECORDS_DIR: '/tmp/judge',
        JUDGE_SPEND: 'true',
      }).spends,
    ).toBe(true)
  })

  // The judging entry reads both arms, so it must not require JUDGE_ARM — a
  // parser shared with the arm capture would make step 3 need a value that
  // means nothing to it.
  it('needs no arm, commit or ref', () => {
    const env = parseSweepEnv({
      JUDGE_SWEEP_ID: 'swp_1',
      JUDGE_AGENTS: 'chief_of_staff',
      JUDGE_RECORDS_DIR: '/tmp/judge',
    })
    expect(env.sweepId).toBe('swp_1')
    expect(env.agentIds).toEqual(['chief_of_staff'])
  })

  // THE ENTRY THAT ACTS ON IT. The arms parse the same value through the
  // shared schema, but it is this step that turns a refusal into a qualifier,
  // so a parser that carried it only to the arms would carry it nowhere.
  it.each([
    [EXPLICIT_SELECTION, true],
    ['auto', false],
    ['', false],
  ] as const)('carries JUDGE_SELECTION=%o as %o', (value, expected) => {
    expect(
      parseSweepEnv({
        JUDGE_SWEEP_ID: 'swp_1',
        JUDGE_AGENTS: 'chief_of_staff',
        JUDGE_RECORDS_DIR: '/tmp/judge',
        [SELECTION_ENV]: value,
      }).explicitSelection,
    ).toBe(expected)
  })

  it('names what is missing for the judging entry', () => {
    expect(() => parseSweepEnv({ JUDGE_AGENTS: 'chief_of_staff' })).toThrow(
      /judging entry cannot run: JUDGE_SWEEP_ID is not set/,
    )
  })
})

// Two gates decide whether real money moves: `spends()` here, which tells an
// arm to drive a real model, and `assertMaySpend` in runners/chatSeam.ts,
// which refuses to install the seam without a script. They were written on
// separate branches against different literals — 'true' and '1' — and the
// merge of those branches failed closed on the first case of any live sweep,
// with an error naming a forgotten field rather than the mismatch. These pin
// both to the one constant so they cannot drift apart again.
describe('the spend switch is one value, not two', () => {
  it('is the value the workflow sets', () => {
    // .github/workflows/judge.yml sets JUDGE_SPEND: 'true' on all three
    // judge-process steps, and judgeWorkflow.test.ts asserts it there.
    expect(SPEND_VALUE).toBe('true')
  })

  it('agrees with the arm-capture gate', () => {
    expect(parseArmEnv(armEnv({ JUDGE_SPEND: SPEND_VALUE })).spends).toBe(true)
  })

  it('agrees with the seam gate on the same value', () => {
    expect(spendsRealMoney({ [SPEND_ENV]: SPEND_VALUE })).toBe(true)
  })

  it.each(['1', 'yes', 'TRUE', 'True', ' true', ''])(
    'reads %o as "do not spend" on both gates',
    (value) => {
      expect(parseArmEnv(armEnv({ JUDGE_SPEND: value })).spends).toBe(false)
      expect(spendsRealMoney({ [SPEND_ENV]: value })).toBe(false)
    },
  )
})
