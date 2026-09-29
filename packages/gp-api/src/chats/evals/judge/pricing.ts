import type { TokenUsage } from './record'

// Token prices, per million tokens, in USD.
//
// This exists because a stored dollar figure is not durable. A cached base
// arm captured months before its candidate was priced under whatever the
// table said then, so comparing the two stored numbers measures Anthropic's
// price list as much as the branch. Records therefore carry raw token counts
// and a pricing version, and the cost delta is RE-DERIVED at comparison time
// from one table. A price change then re-prices all of history for free,
// which is the same property that lets a rubric change re-grade stored
// records without re-running an agent.
//
// Bump this whenever a rate below changes, so an older record is comparable
// only against the table it was priced under.
export const PRICING_VERSION = '2026-09'

export interface ModelRates {
  inputPerMillion: number
  outputPerMillion: number
  // Null until someone looks them up.
  //
  // Prompt caching is NOT enabled today — uncached arithmetic reproduces a
  // real turn's logged cost to the cent — so no record carries cache tokens
  // yet. That is exactly why these are here and why they are null rather
  // than guessed: the day caching is switched on, pricing a cache read at
  // the full input rate overstates it by roughly ten times, and every
  // stored comparison silently becomes wrong. Pricing throws instead.
  cacheReadPerMillion: number | null
  cacheWritePerMillion: number | null
}

// A model is only listed once someone has looked its rates up. An unknown
// model throws rather than defaulting to zero or to a neighbour's rate,
// because the cost delta is evidence printed beside a verdict and a guessed
// rate makes it fiction.
const RATES: Record<string, ModelRates> = {
  // Verified against a real turn: 153,773 input + 3,878 output reproduces
  // the harness's own logged turnCostUsd of 0.5195 exactly at these rates.
  'claude-sonnet-4-6': {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: null,
    cacheWritePerMillion: null,
  },
}

export class UnpriceableRunError extends Error {}

export const ratesFor = (model: string): ModelRates => {
  const rates = RATES[model]
  if (!rates) {
    throw new UnpriceableRunError(
      `no price on record for model "${model}": add its rates to ` +
        'pricing.ts rather than letting a run be costed at zero',
    )
  }
  return rates
}

// Derives cost from token counts. Use this to compare two records; use the
// record's own stored figure only to show what it cost at capture time.
export const priceUsd = (tokens: TokenUsage, model: string): number => {
  const rates = ratesFor(model)
  const perMillion = (count: number, rate: number): number =>
    (count * rate) / 1_000_000

  let usd =
    perMillion(tokens.input, rates.inputPerMillion) +
    perMillion(tokens.output, rates.outputPerMillion)

  if (tokens.cacheRead > 0) {
    if (rates.cacheReadPerMillion === null) {
      throw new UnpriceableRunError(
        `run used ${tokens.cacheRead} cache-read tokens but "${model}" has ` +
          'no cache-read rate on record; pricing them as ordinary input ' +
          'would overstate the cost by roughly ten times',
      )
    }
    usd += perMillion(tokens.cacheRead, rates.cacheReadPerMillion)
  }

  if (tokens.cacheWrite > 0) {
    if (rates.cacheWritePerMillion === null) {
      throw new UnpriceableRunError(
        `run used ${tokens.cacheWrite} cache-write tokens but "${model}" ` +
          'has no cache-write rate on record',
      )
    }
    usd += perMillion(tokens.cacheWrite, rates.cacheWritePerMillion)
  }

  return usd
}

// Two records are only comparable on cost when they were priced the same
// way. Re-deriving with priceUsd makes that true regardless, but a mismatch
// is worth surfacing: it means one arm predates a price change, which is
// also a hint that a cached base arm is stale.
export const sharesPricing = (a: string, b: string): boolean => a === b
