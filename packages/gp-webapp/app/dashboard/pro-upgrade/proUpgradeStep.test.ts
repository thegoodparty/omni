import { describe, it, expect } from 'vitest'
import {
  deriveProUpgradeStep,
  filingStatusFromDetails,
  PRO_UPGRADE_STEP,
  PRO_UPGRADE_STEP_ORDER,
  PRO_UPGRADE_STEP_ORDER_PURCHASE_ONLY,
  proUpgradeStepOrder,
  type FilingStatus,
  type ProUpgradeStepInputs,
} from './proUpgradeStep'

// A candidate who has answered "yes, I've filed" and has every pre-payment
// prerequisite complete. Individual cases override one field at a time so the
// assertion isolates the step that field gates.
const allComplete: ProUpgradeStepInputs = {
  isPro: false,
  filingStatus: 'has-filed',
  hasEin: true,
  filingComplete: true,
  profileComplete: true,
  pinComplete: true,
}

describe('deriveProUpgradeStep', () => {
  describe('already Pro', () => {
    // isPro short-circuits to the post-payment surface regardless of every
    // pre-payment input, including PIN/filing completeness.
    const proCases: Array<Partial<ProUpgradeStepInputs>> = [
      {
        filingStatus: 'unanswered',
        hasEin: false,
        filingComplete: false,
        profileComplete: false,
        pinComplete: false,
      },
      {
        filingStatus: 'not-filed',
        hasEin: false,
        filingComplete: false,
        profileComplete: false,
        pinComplete: false,
      },
      {
        filingStatus: 'has-filed',
        hasEin: true,
        filingComplete: true,
        profileComplete: true,
        pinComplete: false,
      },
      {
        filingStatus: 'has-filed',
        hasEin: true,
        filingComplete: true,
        profileComplete: true,
        pinComplete: true,
      },
    ]

    it.each(proCases)(
      'routes an already-Pro candidate to SUCCESS, never payment (%o)',
      (overrides) => {
        const step = deriveProUpgradeStep({
          ...allComplete,
          isPro: true,
          ...overrides,
        })
        expect(step).toBe(PRO_UPGRADE_STEP.SUCCESS)
        expect(step).not.toBe(PRO_UPGRADE_STEP.PAYMENT)
      },
    )
  })

  describe('not yet Pro — first incomplete step wins', () => {
    it('lands a brand-new candidate (no progress) on the value-prop intro', () => {
      expect(
        deriveProUpgradeStep({
          isPro: false,
          filingStatus: 'unanswered',
          hasEin: false,
          filingComplete: false,
          profileComplete: false,
          pinComplete: false,
        }),
      ).toBe(PRO_UPGRADE_STEP.VALUE_PROP)
    })

    it('skips the value-prop intro once any progress exists', () => {
      // Profile started but filing question still unanswered: past the intro,
      // so the filing-status question is the first incomplete step.
      expect(
        deriveProUpgradeStep({
          isPro: false,
          filingStatus: 'unanswered',
          hasEin: false,
          filingComplete: false,
          profileComplete: true,
          pinComplete: false,
        }),
      ).toBe(PRO_UPGRADE_STEP.STATUS)
    })

    it('restarts a "not filed" candidate with no other progress at the value-prop intro (ENG-10372)', () => {
      // A "not filed" answer is a branch point, not progress. On its own it must
      // not strand the returning candidate on the filing-instructions dead-end;
      // they restart at the value prop and re-answer in the linear flow.
      expect(
        deriveProUpgradeStep({
          isPro: false,
          filingStatus: 'not-filed',
          hasEin: false,
          filingComplete: false,
          profileComplete: false,
          pinComplete: false,
        }),
      ).toBe(PRO_UPGRADE_STEP.VALUE_PROP)
    })

    it('never derives the filing-instructions dead-end, even for a "not filed" candidate with downstream progress', () => {
      // filing-instructions is reached only by explicit navigation from the
      // status step (like guidance); the router resumes real progress instead.
      const step = deriveProUpgradeStep({
        ...allComplete,
        filingStatus: 'not-filed',
        hasEin: false,
      })
      expect(step).toBe(PRO_UPGRADE_STEP.EIN)
      expect(step).not.toBe(PRO_UPGRADE_STEP.FILING_INSTRUCTIONS)
    })

    // With the filing question answered "has-filed", each remaining
    // prerequisite gates its step in canonical order.
    const orderedCases: Array<{
      name: string
      overrides: Partial<ProUpgradeStepInputs>
      expected: string
    }> = [
      {
        name: 'no EIN → EIN step',
        overrides: { hasEin: false },
        expected: PRO_UPGRADE_STEP.EIN,
      },
      {
        name: 'EIN present but TCR filing incomplete → filing-details step',
        overrides: { filingComplete: false },
        expected: PRO_UPGRADE_STEP.FILING_DETAILS,
      },
      {
        name: 'filing complete but profile incomplete → candidate-profile step',
        overrides: { profileComplete: false },
        expected: PRO_UPGRADE_STEP.CANDIDATE_PROFILE,
      },
      {
        name: 'everything collected, not yet Pro → payment step',
        overrides: {},
        expected: PRO_UPGRADE_STEP.PAYMENT,
      },
    ]

    it.each(orderedCases)('$name', ({ overrides, expected }) => {
      expect(deriveProUpgradeStep({ ...allComplete, ...overrides })).toBe(
        expected,
      )
    })

    it('returns the earliest incomplete step, not a later one (profile complete, no EIN → EIN)', () => {
      expect(
        deriveProUpgradeStep({
          ...allComplete,
          hasEin: false,
          filingComplete: false,
          profileComplete: true,
        }),
      ).toBe(PRO_UPGRADE_STEP.EIN)
    })

    it('ignores PIN completeness when gating pre-payment steps', () => {
      // PIN is a post-payment concern; toggling it must not change the
      // pre-payment landing step.
      const base: ProUpgradeStepInputs = { ...allComplete, hasEin: false }
      const withPin = deriveProUpgradeStep({ ...base, pinComplete: true })
      const withoutPin = deriveProUpgradeStep({ ...base, pinComplete: false })
      expect(withPin).toBe(PRO_UPGRADE_STEP.EIN)
      expect(withoutPin).toBe(PRO_UPGRADE_STEP.EIN)
    })
  })

  it('covers every filing-status value', () => {
    const statuses: FilingStatus[] = ['unanswered', 'has-filed', 'not-filed']
    for (const filingStatus of statuses) {
      expect(() =>
        deriveProUpgradeStep({ ...allComplete, filingStatus }),
      ).not.toThrow()
    }
  })
})

describe('filingStatusFromDetails', () => {
  // The persisted answer is a tri-state boolean on campaign.details: the
  // candidate has answered yes (true), answered no (false), or not answered
  // (undefined/null). This is the single mapping both the wizard index (read)
  // and the filing-status step (write) share, so a "yes" candidate is never
  // re-asked on return.
  it('maps a true (already filed) answer to has-filed', () => {
    expect(filingStatusFromDetails(true)).toBe('has-filed')
  })

  it('maps a false (not yet filed) answer to not-filed', () => {
    expect(filingStatusFromDetails(false)).toBe('not-filed')
  })

  it('treats an unset answer as unanswered', () => {
    expect(filingStatusFromDetails(undefined)).toBe('unanswered')
    expect(filingStatusFromDetails(null)).toBe('unanswered')
  })
})

describe('deriveProUpgradeStep purchase-only mode', () => {
  const inputs = {
    isPro: false,
    filingStatus: 'unanswered' as const,
    hasEin: false,
    filingComplete: false,
    profileComplete: false,
    pinComplete: false,
  }
  const opts = { purchaseOnly: true }

  it('lands a brand-new candidate on guidance instead of value-prop', () => {
    expect(deriveProUpgradeStep(inputs, opts)).toBe(PRO_UPGRADE_STEP.GUIDANCE)
  })

  it('asks filing status once there is progress and it is unanswered', () => {
    expect(deriveProUpgradeStep({ ...inputs, hasEin: true }, opts)).toBe(
      PRO_UPGRADE_STEP.STATUS,
    )
  })

  it('resumes at EIN for a filed candidate without one', () => {
    expect(
      deriveProUpgradeStep({ ...inputs, filingStatus: 'has-filed' }, opts),
    ).toBe(PRO_UPGRADE_STEP.EIN)
  })

  it('re-asks filing status for a "not filed" candidate even with an EIN on file', () => {
    expect(
      deriveProUpgradeStep(
        { ...inputs, filingStatus: 'not-filed', hasEin: true },
        opts,
      ),
    ).toBe(PRO_UPGRADE_STEP.STATUS)
  })

  it('goes straight to payment once filed and EIN are in, ignoring filing and profile', () => {
    expect(
      deriveProUpgradeStep(
        { ...inputs, filingStatus: 'has-filed', hasEin: true },
        opts,
      ),
    ).toBe(PRO_UPGRADE_STEP.PAYMENT)
  })

  it('ignores filing and profile completeness as progress', () => {
    expect(
      deriveProUpgradeStep(
        { ...inputs, filingComplete: true, profileComplete: true },
        opts,
      ),
    ).toBe(PRO_UPGRADE_STEP.GUIDANCE)
  })

  it('still routes Pro to success', () => {
    expect(deriveProUpgradeStep({ ...inputs, isPro: true }, opts)).toBe(
      PRO_UPGRADE_STEP.SUCCESS,
    )
  })

  it('exposes the purchase-only linear order', () => {
    expect(PRO_UPGRADE_STEP_ORDER_PURCHASE_ONLY).toEqual([
      PRO_UPGRADE_STEP.GUIDANCE,
      PRO_UPGRADE_STEP.STATUS,
      PRO_UPGRADE_STEP.EIN,
      PRO_UPGRADE_STEP.PAYMENT,
      PRO_UPGRADE_STEP.SUCCESS,
    ])
    expect(proUpgradeStepOrder(false)).toBe(PRO_UPGRADE_STEP_ORDER)
    expect(proUpgradeStepOrder(true)).toBe(PRO_UPGRADE_STEP_ORDER_PURCHASE_ONLY)
  })
})
