import { describe, expect, it } from 'vitest'
import { audienceEmptyMessage, hasEmptiableCriteria } from './emptiableCriteria'

describe('hasEmptiableCriteria', () => {
  // The gate on whether the who step asks the server anything. These three
  // resolve to a person-id set out of Postgres, and an empty set is what the
  // create refuses on.
  it('recognises the three criteria that can resolve to nobody', () => {
    expect(hasEmptiableCriteria({ supportStatus: ['supporter'] })).toBe(true)
    expect(
      hasEmptiableCriteria({
        activityConditions: [{ outreachType: 'text', actions: ['responded'] }],
      }),
    ).toBe(true)
    expect(hasEmptiableCriteria({ contactsMade3: true })).toBe(true)
  })

  // Everything else becomes a column predicate the people database evaluates.
  // A predicate matching no rows is a different failure, discovered by a
  // voter-data read this endpoint deliberately does not make — so asking about
  // one of these is a round trip whose answer is known in advance.
  it('ignores the filters that narrow a query instead of resolving a set', () => {
    expect(
      hasEmptiableCriteria({
        partyDemocrat: true,
        age65Plus: true,
        precincts: ['Sangamon|14'],
        languageCodes: ['es'],
      }),
    ).toBe(false)
    expect(hasEmptiableCriteria({})).toBe(false)
  })

  // An empty array is not a criterion. A saved list can carry one — the CRM
  // persists the column whether or not anything was picked — and treating it
  // as present would fire a request on every list pick.
  it('does not count an empty criteria array as a criterion', () => {
    expect(
      hasEmptiableCriteria({ supportStatus: [], activityConditions: [] }),
    ).toBe(false)
  })

  // A false bucket is the shape `transformVoterFileFiltersForBackend` sends
  // for every contacts-made option nobody picked, so it is on every payload.
  it('does not count unpicked contacts-made buckets', () => {
    expect(
      hasEmptiableCriteria({ contactsMade0: false, contactsMade5Plus: false }),
    ).toBe(false)
  })
})

describe('audienceEmptyMessage', () => {
  // Read off the flow's own boolean draft, where a list's support-status and
  // activity clauses survive only as the marks `savedListFilterKeys` leaves.
  it('names the criterion the draft carries', () => {
    expect(audienceEmptyMessage({ supportStatus: true })).toBe(
      'No contacts match this list’s support status filters. Pick a ' +
        'different list, or edit it in your contacts.',
    )
  })

  // All of them, because the resolution intersects its inputs and reports one
  // flag — which one was decisive is not in the answer, and naming them all is
  // both true and what points at the pills to go and look at.
  it('names every emptiable criterion rather than guessing the decisive one', () => {
    expect(
      audienceEmptyMessage({
        supportStatus: true,
        activityConditions: true,
        contactsMade2: true,
      }),
    ).toContain('support status, previous outreach, and contacts made')
  })

  it('joins two criteria without a list comma', () => {
    expect(
      audienceEmptyMessage({ supportStatus: true, activityConditions: true }),
    ).toContain('support status and previous outreach filters')
  })

  // The who step reaches this from two faces. Citing "this list" to a
  // candidate who is building one out of pills describes something that does
  // not exist — the same failure `unpreviewableDisclosureSentence` fixed.
  it('does not cite a list when the draft is hand-built', () => {
    const message = audienceEmptyMessage({ supportStatus: true }, false)
    expect(message).toBe(
      'No contacts match your support status filters. Adjust them to continue.',
    )
    expect(message).not.toContain('list')
  })

  // Should be unreachable — the check is only asked for a draft carrying one
  // of these — so it returns null rather than a sentence with a hole in it.
  it('answers null for a draft naming no emptiable criterion', () => {
    expect(audienceEmptyMessage({ partyDemocrat: true })).toBeNull()
  })
})
