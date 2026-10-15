import { describe, expect, it } from 'vitest'
import {
  PRICING_VERSION,
  priceUsd,
  ratesFor,
  sharesPricing,
  UnpriceableRunError,
} from './pricing'
import { CHAT_PAIR } from './fixtures/records'
import { DEFAULT_JUDGE_CONFIG } from './config'
import { BRIEFING_CHAT_MODELS } from '@/chats/briefing-chats/briefingAnnotation.handler'
import { CAMPAIGN_MANAGER_MODELS } from '@/chats/general/campaign-manager/campaignManager.handler'
import { CHIEF_OF_STAFF_MODELS } from '@/chats/general/chief-of-staff/chiefOfStaff.handler'
import { ORDINANCE_FLOW_MODELS } from '@/chats/general/ordinance-flow/ordinanceFlow.handler'
import { PRIORITY_FLOW_MODELS } from '@/chats/general/priority-flow/priorityFlow.handler'

const tokens = (o: Partial<Parameters<typeof priceUsd>[0]> = {}) => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  ...o,
})

describe('priceUsd', () => {
  // The rates in the table are only trustworthy because this arithmetic was
  // checked against a real turn: the harness logged turnCostUsd 0.5195 for
  // exactly these counts. If this test ever fails, the table moved.
  it('reproduces the measured cost of a real ordinance-flow turn', () => {
    const usd = priceUsd(
      tokens({ input: 153_773, output: 3_878 }),
      'claude-sonnet-4-6',
    )
    expect(usd).toBeCloseTo(0.5195, 4)
  })

  it('reproduces the measured cost of a real Chief of Staff turn', () => {
    const usd = priceUsd(
      tokens({ input: 31_213, output: 227 }),
      'claude-sonnet-4-6',
    )
    expect(usd).toBeCloseTo(0.097, 3)
  })

  it('costs a run with no tokens at nothing', () => {
    expect(priceUsd(tokens(), 'claude-sonnet-4-6')).toBe(0)
  })

  // The whole point of the table: an unpriced model must not be costed at
  // zero, because the cost delta is printed beside a verdict as evidence.
  it('refuses a model it has no rates for', () => {
    expect(() => priceUsd(tokens({ input: 100 }), 'some-new-model')).toThrow(
      UnpriceableRunError,
    )
  })

  it('names the model it could not price', () => {
    expect(() => priceUsd(tokens({ input: 100 }), 'gpt-9')).toThrow(/gpt-9/)
  })

  // The near-term failure mode. Caching is off today, so every record's
  // cache counts are zero and this never fires. Turn caching on without
  // adding rates and it fires immediately, which is the intent: pricing a
  // cache read at the full input rate overstates it by roughly ten times and
  // silently invalidates every stored comparison.
  it('refuses to price cache reads at the input rate', () => {
    expect(() =>
      priceUsd(tokens({ input: 10, cacheRead: 5_000 }), 'claude-sonnet-4-6'),
    ).toThrow(UnpriceableRunError)
  })

  it('refuses to price cache writes without a rate', () => {
    expect(() =>
      priceUsd(tokens({ cacheWrite: 5_000 }), 'claude-sonnet-4-6'),
    ).toThrow(UnpriceableRunError)
  })
})

describe('ratesFor', () => {
  it('has no cache rates yet, which is what makes pricing fail loudly', () => {
    const rates = ratesFor('claude-sonnet-4-6')
    expect(rates.cacheReadPerMillion).toBeNull()
    expect(rates.cacheWritePerMillion).toBeNull()
  })
})

describe('re-deriving cost rather than trusting it', () => {
  // A record's stored figure is a snapshot under its own pricing version.
  // Comparing two of them across a price change would measure the price
  // list; re-deriving from tokens is what keeps the delta about the branch.
  it('matches the fixture snapshot under the current table', () => {
    const [base] = CHAT_PAIR
    expect(base.telemetry.cost?.pricingVersion).toBe(PRICING_VERSION)
    expect(priceUsd(base.telemetry.tokens, base.variant.model)).toBeCloseTo(
      base.telemetry.cost?.usdAtCapture ?? NaN,
      3,
    )
  })

  it('flags arms priced under different tables', () => {
    expect(sharesPricing('2026-09', '2026-09')).toBe(true)
    expect(sharesPricing('2026-09', '2027-01')).toBe(false)
  })
})

// Every model a chat arm can record and every judge seat has to be priceable,
// or its spend reads as "at least $X" on the report. Listed from the handlers'
// own constants, so a new model fails here by name rather than in a sweep.
describe('every chat model and judge seat has rates', () => {
  const models = [
    ...new Set([
      ...CHIEF_OF_STAFF_MODELS,
      ...CAMPAIGN_MANAGER_MODELS,
      ...ORDINANCE_FLOW_MODELS,
      ...PRIORITY_FLOW_MODELS,
      ...BRIEFING_CHAT_MODELS,
      ...DEFAULT_JUDGE_CONFIG.panel.seats,
    ]),
  ]

  it.each(models)('%s', (model) => {
    expect(() => ratesFor(model)).not.toThrow()
  })
})
