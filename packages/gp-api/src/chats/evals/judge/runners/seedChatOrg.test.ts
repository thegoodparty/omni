import { describe, expect, it } from 'vitest'
import type { ChatAccountState } from '../cases'
import { ChatScope } from '../../../../generated/prisma'
import {
  assertAccountStateSupported,
  chatOrgSlug,
  chatScopeFor,
  seedOptionsFor,
} from './seedChatOrg'

// The runner resolves a handler straight from the agent id, so a scope
// missing from this map is an agent the judge lists and cannot drive.
describe('chatScopeFor', () => {
  it('drives briefing chat as its registered scope', () => {
    expect(chatScopeFor('briefing_annotation')).toBe(
      ChatScope.briefing_annotation,
    )
  })

  it('refuses an agent that is not a chat scope', () => {
    expect(() => chatScopeFor('meeting_briefing')).toThrow(
      'not a chat scope the runner can drive',
    )
  })
})

// The slug this derives is `organization.slug`, the table's primary key, and
// the sweep seeds one organization per case PER ATTEMPT — so two attempts
// that derive one slug are the unique-constraint failure the per-attempt key
// exists to close. The derivation shortens, which is what could take the
// attempt suffix away again.
describe('chatOrgSlug', () => {
  const LONG_CASE = 'constituent-count-by-precinct-and-party'

  it('keeps the attempts of a long case id apart', () => {
    const slugs = [1, 2, 3].map((attempt) =>
      chatOrgSlug('chief_of_staff', `${LONG_CASE}-${attempt}`),
    )
    expect(new Set(slugs).size).toBe(3)
  })

  it('keeps two long case ids sharing a prefix apart', () => {
    expect(chatOrgSlug('chief_of_staff', `${LONG_CASE}-north-1`)).not.toBe(
      chatOrgSlug('chief_of_staff', `${LONG_CASE}-south-1`),
    )
  })

  it('keeps two agents on one case id apart', () => {
    expect(chatOrgSlug('chief_of_staff', `${LONG_CASE}-1`)).not.toBe(
      chatOrgSlug('priority_flow', `${LONG_CASE}-1`),
    )
  })

  // Both arms must seed the same slug for a case and attempt, or the system
  // prompts differ and every configDigest with them.
  it('is the same slug for the same case and attempt', () => {
    expect(chatOrgSlug('chief_of_staff', `${LONG_CASE}-2`)).toBe(
      chatOrgSlug('chief_of_staff', `${LONG_CASE}-2`),
    )
  })

  // 100 is what `organization.schema.ts` accepts for a slug.
  it('stays inside the length a slug is allowed', () => {
    expect(
      chatOrgSlug('chief_of_staff', `${'x'.repeat(300)}-1`).length,
    ).toBeLessThanOrEqual(100)
  })

  it('keeps a readable prefix so a seeded row can be recognised', () => {
    expect(chatOrgSlug('chief_of_staff', `${LONG_CASE}-1`)).toMatch(
      /^judge-chief-of-staff-constituent/,
    )
  })
})

// AN UNRECOGNISED STATE MUST REFUSE, NOT PROCEED, and this is the half the
// schema cannot catch: a state that IS defined but means nothing for this
// scope. `ChatAccountStateSchema.strict()` refuses a state nobody defined;
// this refuses asking a Chief of Staff office to lose Pro, where no campaign
// row exists to carry the flag. Seeding nothing and recording the directive
// anyway would put a condition on the record the agent was never under.
describe('seedOptionsFor', () => {
  it('asks the seeder for nothing when the case declared nothing', () => {
    expect(seedOptionsFor('chief_of_staff')).toEqual({})
  })

  it('maps the ordinance step onto the anchor the seeder opens', () => {
    expect(
      seedOptionsFor('ordinance_flow', { ordinanceStep: 'draft' }),
    ).toEqual({ step: 'draft' })
  })

  it('maps the campaign states the Win scope can express', () => {
    expect(
      seedOptionsFor('campaign_assistant', {
        pro: false,
        campaignDetails: false,
        district: false,
      }),
    ).toEqual({ pro: false, campaignDetails: false, district: false })
  })

  // No campaign row on a Serve scope, so `isPro` is a flag with nowhere to
  // live.
  it('refuses Pro on a scope with no campaign', () => {
    expect(() => seedOptionsFor('chief_of_staff', { pro: false })).toThrow(
      /chief_of_staff cannot express the account state pro/,
    )
  })

  it('refuses campaign details on a scope with no campaign', () => {
    expect(() =>
      seedOptionsFor('priority_flow', { campaignDetails: false }),
    ).toThrow(/priority_flow cannot express the account state campaignDetails/)
  })

  // An ordinance step on a scope with no ordinance anchor is a step nothing
  // would open on.
  it('refuses an ordinance step on a scope with no ordinance', () => {
    expect(() =>
      seedOptionsFor('chief_of_staff', { ordinanceStep: 'draft' }),
    ).toThrow(/ordinanceStep/)
  })

  it('names the states the scope CAN express, so the fix is obvious', () => {
    expect(() => seedOptionsFor('priority_flow', { pro: false })).toThrow(
      /the states it can express are district/,
    )
  })

  it('maps the briefing highlight onto the anchor the seeder opens', () => {
    expect(
      seedOptionsFor('briefing_annotation', { briefingHighlight: true }),
    ).toEqual({ briefingHighlight: true })
  })

  // A highlight is a place in a briefing, and only one scope has a briefing.
  it('refuses a briefing highlight on a scope with no briefing', () => {
    expect(() =>
      seedOptionsFor('chief_of_staff', { briefingHighlight: true }),
    ).toThrow(/chief_of_staff cannot express the account state briefingHigh/)
  })

  // Briefing chat resolves its district from the briefing's own org, which
  // is the org this case seeded, so the state reaches the seed.
  it('maps the district state on briefing chat', () => {
    expect(
      seedOptionsFor('briefing_annotation', {
        district: false,
        briefingHighlight: true,
      }),
    ).toEqual({ district: false, briefingHighlight: true })
  })

  // Every scope seeds an organization, and positionId is a column on it.
  it('allows the district state on every scope', () => {
    for (const agentId of [
      'chief_of_staff',
      'campaign_assistant',
      'ordinance_flow',
      'priority_flow',
      'briefing_annotation',
    ]) {
      expect(() =>
        assertAccountStateSupported(agentId, { district: false }),
      ).not.toThrow()
    }
  })

  // THE EXHAUSTIVENESS GUARD, and the reason the account vocabulary's several
  // copies cannot silently disagree. STATES_BY_SCOPE is keyed on
  // `keyof ChatAccountState`, so a fifth state added to the schema is in no
  // scope's list until somebody puts it there — and until then every case
  // declaring it is refused, rather than seeded as nothing while the record
  // claims the condition.
  it('refuses a state no scope has been told it can express', () => {
    expect(() =>
      // Cast on purpose: the state being described is one the schema knows
      // and the seeder has not been taught, which no valid ChatAccountState
      // can name today.
      assertAccountStateSupported('chief_of_staff', {
        unwired: true,
      } as ChatAccountState),
    ).toThrow(/cannot express the account state unwired/)
  })
})
