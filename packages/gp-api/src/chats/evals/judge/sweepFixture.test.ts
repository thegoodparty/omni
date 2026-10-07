import { describe, expect, it } from 'vitest'
import { substituteBackgroundCases } from './caseParams'
import { armEnvFor, SWEEP_VALUES } from './fixtures/sweep'
import { parseArmEnv } from './sweepEnv'
import { describeFixtureEnv, fixtureEnv } from './sweepFixture'

// The reading half of the thread is `parseArmEnv`: blank-means-unset is
// defined there, once, for these three and the Delta version together, and
// sweepEnv.test.ts covers that rule directly. What is proven here is that the
// EXPORTING half feeds it — a rename on either side shows up as an identifier
// that does not come back.
const { orgSlug: ORG_SLUG, raceId: RACE_ID, userEmail: EMAIL } = SWEEP_VALUES

describe('reaching both arms', () => {
  const IDENTIFIERS = {
    orgSlug: ORG_SLUG,
    raceId: RACE_ID,
    userEmail: EMAIL,
  }

  // One arm, named. The two arms differ in more than the fixture — a
  // different `JUDGE_ARM`, a different commit — so reading the export back
  // under each arm's own environment is what shows the params do not depend
  // on anything arm-specific.
  const valuesInArm = (
    arm: 'base' | 'candidate',
    exported: Record<string, string>,
  ) =>
    parseArmEnv(
      armEnvFor({
        ...exported,
        JUDGE_ARM: arm,
        JUDGE_AGENTS: 'top_community_issues',
        ...(arm === 'base' && { JUDGE_ARM_COMMIT: 'c'.repeat(40) }),
      }),
    ).fixtureValues

  it('round-trips every identifier through the environment', () => {
    expect(valuesInArm('candidate', fixtureEnv(IDENTIFIERS))).toEqual(
      IDENTIFIERS,
    )
  })

  // By value against the literal names, not against the constant the function
  // is built from — these are the three variables a workflow step has to
  // export, so a rename must break here rather than agree with itself.
  it('names one variable per placeholder', () => {
    expect(fixtureEnv(IDENTIFIERS)).toEqual({
      JUDGE_FIXTURE_ORG_SLUG: ORG_SLUG,
      JUDGE_FIXTURE_RACE_ID: RACE_ID,
      JUDGE_FIXTURE_USER_EMAIL: EMAIL,
    })
  })

  it('says which variable supplies which token', () => {
    expect(describeFixtureEnv()).toBe(
      '{judgeOrgSlug} from JUDGE_FIXTURE_ORG_SLUG, ' +
        '{judgeRaceId} from JUDGE_FIXTURE_RACE_ID, ' +
        '{judgeUserEmail} from JUDGE_FIXTURE_USER_EMAIL',
    )
  })

  // The property the whole design exists for. The two arms are two processes
  // in two worktrees, so this is the only thing that makes their params
  // identical: one resolution, one environment, two reads.
  it('gives two arm processes byte-identical params', () => {
    const exported = fixtureEnv(IDENTIFIERS)
    const cases = [
      {
        caseId: 'baseline',
        params: {
          organization_slug: '{judgeOrgSlug}',
          race_id: '{judgeRaceId}',
          user_email: '{judgeUserEmail}',
        },
      },
    ]

    const base = substituteBackgroundCases(cases, valuesInArm('base', exported))
    const candidate = substituteBackgroundCases(
      cases,
      valuesInArm('candidate', exported),
    )

    expect(JSON.stringify(candidate)).toBe(JSON.stringify(base))
    expect(base.map((one) => one.params)).toEqual([
      {
        organization_slug: ORG_SLUG,
        race_id: RACE_ID,
        user_email: EMAIL,
      },
    ])
  })
})
