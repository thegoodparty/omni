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

  // THE ALIAS, not a second name for the entry above. Every background
  // experiment's manifest carries `"model": "sonnet"` and that string is what
  // reaches the record, because a judge run may change what an agent is told
  // to do and never what model it runs on — so the manifest's value is read
  // rather than replaced. The Claude SDK resolves it on the Fargate side.
  //
  // Listed rather than mapped onto 'claude-sonnet-4-6' because the two are not
  // the same claim. That entry is one model id someone verified against one
  // logged turn; this one is "whatever the agent harness resolves `sonnet` to",
  // which is a moving target by design. Collapsing them would quietly assert
  // the alias is pinned.
  //
  // Same rates the harness itself prices with — gp-ai/pmf_engine/runner/
  // harness/claude_sdk.py `_PRICE_PER_MTOK`. The cache figures are Anthropic's
  // published multipliers off the input rate, 0.1x for a read and 1.25x for a
  // 5-minute write. Filled in rather than left null because background runs
  // are long agentic loops that really do cache — background.ts accumulates
  // both counts — and a null here would send every one of them down
  // captureCostUsd's degraded path, which falls back to the harness's own
  // total and loses the re-derivation this table exists to provide.
  sonnet: {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
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
