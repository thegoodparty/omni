import { describe, expect, it } from 'vitest'
import { ratesFor, UnpriceableRunError } from '../pricing'
import { AGENTS } from '../agents'
import { agentConfigFor, AgentConfigError } from './agentConfig'

// A judge override may change what an agent is TOLD to do and never what it is
// ALLOWED to touch. The consumer refuses a manifest carrying anything else,
// and the dispatch Lambda refuses the whole override for a write-action
// experiment — but this is the place that decides what gets sent, so it is the
// place to prove the narrowing happens.
describe('agentConfigFor', () => {
  const published = {
    id: 'race_opponent_summary',
    version: 3,
    model: 'claude-sonnet-4-6',
    max_turns: 20,
    timeout_seconds: 900,
    output_schema: { type: 'object' },
    runtime: { max_parallel_subagents: 0, max_thinking_tokens: 0 },
    // Everything below is what must NOT travel.
    scope: { organization: true },
    routing: { queue: 'agent-dispatch-dev.fifo' },
    input_schema: { type: 'object' },
    system_prompt: 'you may write things',
    permission_mode: 'bypassPermissions',
  }

  const reader =
    (manifest: object, instruction = '# do the thing') =>
    (_agentId: string, leaf: string): string =>
      leaf === 'manifest.json' ? JSON.stringify(manifest) : instruction

  it('keeps only the behavior fields', () => {
    const config = agentConfigFor('race_opponent_summary', reader(published))
    expect(JSON.parse(config.manifest)).toEqual({
      model: 'claude-sonnet-4-6',
      max_turns: 20,
      timeout_seconds: 900,
      output_schema: { type: 'object' },
      runtime: { max_parallel_subagents: 0, max_thinking_tokens: 0 },
    })
  })

  // Named individually, because each one is a different way for a judge run to
  // reach something nobody staged.
  it.each([
    'scope',
    'routing',
    'input_schema',
    'system_prompt',
    'permission_mode',
    'id',
    'version',
  ])('drops %s', (field) => {
    const config = agentConfigFor('race_opponent_summary', reader(published))
    expect(Object.keys(JSON.parse(config.manifest))).not.toContain(field)
  })

  it('carries the experiment instruction verbatim', () => {
    const config = agentConfigFor(
      'race_opponent_summary',
      reader(published, '# grade the opponents\nbe careful'),
    )
    expect(config.instruction).toBe('# grade the opponents\nbe careful')
  })

  // A field the Fargate runner requires. Refused HERE, naming the agent,
  // rather than later with the consumer's wording and no agent id in it.
  it.each(['model', 'max_turns', 'output_schema'])(
    'refuses a manifest with no %s',
    (field) => {
      const without: Record<string, unknown> = { ...published }
      delete without[field]
      expect(() =>
        agentConfigFor('race_opponent_summary', reader(without)),
      ).toThrow(new RegExp(`race_opponent_summary.*${field}`))
    },
  )

  // Optional in the behavior set, so its absence is not an error — but it
  // must not be invented either. `timeout_seconds` used to be on this list
  // and moved to REQUIRED_FIELDS when the sweep began deriving its artifact
  // poll from it: there is no honest default for how long to wait out an
  // agent, and the flat constant it replaced was shorter than eleven of the
  // sixteen published agents' own declared timeouts.
  it.each(['runtime'])(
    'omits %s rather than defaulting it when the manifest has none',
    (field) => {
      const without: Record<string, unknown> = { ...published }
      delete without[field]
      const config = agentConfigFor('race_opponent_summary', reader(without))
      expect(Object.keys(JSON.parse(config.manifest))).not.toContain(field)
    },
  )

  it('says which agent and which file when the manifest is not JSON', () => {
    const broken = (_a: string, leaf: string) =>
      leaf === 'manifest.json' ? '{not json' : 'x'
    expect(() => agentConfigFor('meeting_briefing', broken)).toThrow(
      AgentConfigError,
    )
    expect(() => agentConfigFor('meeting_briefing', broken)).toThrow(
      /meeting_briefing/,
    )
  })

  // THE REAL FILES, not a fixture. The projection is only useful if it works
  // on what `publish_experiments.py` actually walks, and a manifest that
  // gained a required field would otherwise be found by a paid sweep.
  it('projects one published experiment end to end', () => {
    const config = agentConfigFor('race_opponent_summary')
    const projected = JSON.parse(config.manifest)
    expect(projected.model).toBeTruthy()
    expect(projected.max_turns).toBeGreaterThan(0)
    expect(typeof projected.output_schema).toBe('object')
    expect(Object.keys(projected)).not.toContain('scope')
    expect(config.instruction.length).toBeGreaterThan(0)
  })
})

// EVERY SWEEPABLE EXPERIMENT, not just the one with a real case list. A
// manifest whose behavior fields are the wrong shape fails the projection, and
// finding that out agent by agent costs a paid capture each time. `runtime`
// being an object rather than a string was found exactly this way.
describe('the published manifests all project', () => {
  const sweepable = AGENTS.filter(
    (agent) => agent.shape === 'background' && agent.status !== 'blocked',
  ).map((agent) => agent.agentId)

  // Pinned, not `> 10`. The loose bound let the scan below keep passing while
  // a third of the registry quietly stopped being covered by it.
  it('finds the background agents', () => {
    expect(sweepable).toHaveLength(15)
  })

  it.each(sweepable)('%s projects to a usable config', (agentId) => {
    const config = agentConfigFor(agentId)
    const projected: Record<string, unknown> = JSON.parse(config.manifest)
    expect(typeof projected.model).toBe('string')
    expect(typeof projected.max_turns).toBe('number')
    // An object, not merely truthy: `"{}"` and `1` are both truthy and both
    // refused by the Fargate consumer's Draft-07 check, which is a failure
    // that costs a dispatch to discover.
    expect(typeof projected.output_schema).toBe('object')
    // The fields that must never travel, checked on the real file rather than
    // on a fixture that cannot drift.
    for (const forbidden of [
      'scope',
      'routing',
      'input_schema',
      'system_prompt',
      'permission_mode',
    ]) {
      expect(Object.keys(projected)).not.toContain(forbidden)
    }
    expect(config.instruction.length).toBeGreaterThan(0)
  })
})

// THE MODEL HAS TO BE ONE THE COST DELTA CAN PRICE, and nothing else checks
// it. `VariantSchema.model` is `z.string().min(1)`, so a record carrying an
// alias stores fine and only fails at `score.ts`'s priceUsd — which catches
// UnpriceableRunError and degrades to a null delta. The cost column is one of
// the judge's three headline outputs, and it would simply be empty for every
// background agent, on a green run, at full price.
//
// This caught the live case: all sixteen manifests say `sonnet` or
// `claude-fable-5`, and RATES held only `claude-sonnet-4-6`.
describe('the published manifests name a model the delta can price', () => {
  const sweepable = AGENTS.filter(
    (agent) => agent.shape === 'background' && agent.status !== 'blocked',
  ).map((agent) => agent.agentId)

  // Named, so that adding its rates is a one-line move off this list rather
  // than a discovery. Listing it is the point: an agent whose cost cannot be
  // reported is a known gap, not a surprise found beside a verdict.
  const UNPRICED = ['race_opponent_actions']

  const modelOf = (agentId: string): string =>
    String(
      (JSON.parse(agentConfigFor(agentId).manifest) as { model?: unknown })
        .model,
    )

  it.each(sweepable.filter((id) => !UNPRICED.includes(id)))(
    "%s's model has rates on record",
    (agentId) => {
      expect(() => ratesFor(modelOf(agentId))).not.toThrow()
    },
  )

  // The other half, so the list above cannot rot into a lie: an agent on it
  // that HAS become priceable fails here and gets taken off.
  it.each(UNPRICED)('%s is still unpriced, and known to be', (agentId) => {
    expect(() => ratesFor(modelOf(agentId))).toThrow(UnpriceableRunError)
  })
})
