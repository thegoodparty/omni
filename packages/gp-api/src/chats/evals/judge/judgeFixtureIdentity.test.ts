import { describe, expect, it } from 'vitest'
import { JUDGE_FIXTURE, JUDGE_USER_EMAIL } from './judgeFixtureIdentity'
import { JUDGE_ORG_SLUG_PREFIX, ORG_SLUG } from './runners/background'

describe('the judge fixture identity', () => {
  // gp-api's session guard treats a sub without this prefix as no user at
  // all, so every gp-api read would 401.
  it('is a clerk id the session guard will look up', () => {
    expect(JUDGE_FIXTURE.clerkUserId).toBe('user_judge_fixture')
    expect(JUDGE_FIXTURE.clerkUserId.startsWith('user_')).toBe(true)
  })

  // The dispatch refuses any slug outside `judge-`, and the Lambda any slug
  // outside its identifier pattern.
  it('is a slug the judge dispatch accepts', () => {
    expect(JUDGE_FIXTURE.orgSlug).toBe('judge-fixture')
    expect(JUDGE_FIXTURE.orgSlug.startsWith(JUDGE_ORG_SLUG_PREFIX)).toBe(true)
    expect(ORG_SLUG.test(JUDGE_FIXTURE.orgSlug)).toBe(true)
  })

  it('reuses the sweep address rather than minting another', () => {
    expect(JUDGE_FIXTURE.email).toBe(JUDGE_USER_EMAIL)
    expect(JUDGE_USER_EMAIL).toBe('judge-sweep@example.com')
  })
})
