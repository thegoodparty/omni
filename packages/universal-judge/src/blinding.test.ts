import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { judgePair } from './pairwise.js'

/**
 * Blinding is the property the whole comparison rests on. If the judge can tell
 * which side is the incumbent, or if a verdict is mapped back to the wrong
 * variant after the outputs are swapped, every number downstream is wrong in a way
 * no amount of sample size would reveal. These tests pin that down without
 * spending anything.
 */

type Call = { system: string; text: string }

const fakeClient = (verdicts: { winner: string; margin: string }[]) => {
  const calls: Call[] = []
  let index = 0
  const client = {
    messages: {
      create: async (args: {
        system: string
        messages: { content: string }[]
      }) => {
        calls.push({ system: args.system, text: args.messages[0].content })
        const verdict = verdicts[Math.min(index, verdicts.length - 1)]
        index += 1
        return {
          content: [
            {
              type: 'tool_use',
              input: {
                winner: verdict.winner,
                margin: verdict.margin,
                deciding_criterion: 'specific over generic',
                rationale: 'a reason',
              },
            },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
          stop_reason: 'tool_use',
        }
      },
    },
  }
  return { client: client as unknown as Anthropic, calls }
}

const run = (verdicts: { winner: string; margin: string }[]) => {
  const { client, calls } = fakeClient(verdicts)
  return judgePair({
    caseId: 'york_pa',
    input: { state: 'PA', office: 'York City Council' },
    baselineOutput: { marker: 'ALPHA_SIDE' },
    candidateOutput: { marker: 'BETA_SIDE' },
    agent: 'find_existing_ordinances',
    client,
    rubric: 'RUBRIC',
  }).then((verdict) => ({ verdict, calls }))
}

describe('blind judging', () => {
  it('judges each pair twice, once in each presentation order', async () => {
    const { calls } = await run([
      { winner: 'output_1', margin: 'better' },
      { winner: 'output_2', margin: 'better' },
    ])
    expect(calls).toHaveLength(2)

    // Whichever side led the first call must trail the second.
    const firstLedByBaseline =
      calls[0].text.indexOf('ALPHA_SIDE') <
      calls[0].text.indexOf('BETA_SIDE')
    const secondLedByBaseline =
      calls[1].text.indexOf('ALPHA_SIDE') <
      calls[1].text.indexOf('BETA_SIDE')
    expect(firstLedByBaseline).not.toBe(secondLedByBaseline)
  })

  it('never tells the judge which side is which', async () => {
    const { calls } = await run([{ winner: 'tie', margin: 'tie' }])
    for (const call of calls) {
      const haystack = `${call.system}\n${call.text}`.toLowerCase()
      expect(haystack).not.toContain('baseline')
      expect(haystack).not.toContain('candidate')
      expect(haystack).not.toContain('incumbent')
      expect(haystack).not.toMatch(/\bmain\b/)
    }
  })

  it('labels the two sides only as Output 1 and Output 2', async () => {
    const { calls } = await run([{ winner: 'tie', margin: 'tie' }])
    expect(calls[0].text).toContain('## Output 1')
    expect(calls[0].text).toContain('## Output 2')
  })

  it('maps a consistent slot preference back to the right variant', async () => {
    // The judge picks whichever slot holds the candidate, both times round.
    const { client, calls } = fakeClient([])
    let call = 0
    const patched = {
      messages: {
        create: async (args: {
          system: string
          messages: { content: string }[]
        }) => {
          calls.push({ system: args.system, text: args.messages[0].content })
          const candidateIsFirst =
            args.messages[0].content.indexOf('BETA_SIDE') <
            args.messages[0].content.indexOf('ALPHA_SIDE')
          call += 1
          return {
            content: [
              {
                type: 'tool_use',
                input: {
                  winner: candidateIsFirst ? 'output_1' : 'output_2',
                  margin: 'much_better',
                  deciding_criterion: 'grounding',
                  rationale: 'the candidate text',
                },
              },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
            stop_reason: 'tool_use',
          }
        },
      },
    }
    void client
    void call

    const verdict = await judgePair({
      caseId: 'york_pa',
      input: {},
      baselineOutput: { marker: 'ALPHA_SIDE' },
      candidateOutput: { marker: 'BETA_SIDE' },
      agent: 'find_existing_ordinances',
      client: patched as unknown as Anthropic,
      rubric: 'RUBRIC',
    })

    expect(verdict.winner).toBe('candidate')
    expect(verdict.margin).toBe('much_better')
    expect(verdict.flipped).toBe(false)
  })

  it('reports a judge that always picks slot one as unstable, not as a winner', async () => {
    // Pure position bias: whatever is shown first wins. This must not produce a
    // verdict for either variant.
    const verdict = (
      await run([
        { winner: 'output_1', margin: 'much_better' },
        { winner: 'output_1', margin: 'much_better' },
      ])
    ).verdict
    expect(verdict.flipped).toBe(true)
    expect(verdict.winner).toBe('tie')
  })

  it('sums judge cost across both passes', async () => {
    const { verdict } = await run([
      { winner: 'tie', margin: 'tie' },
      { winner: 'tie', margin: 'tie' },
    ])
    expect(verdict.judgeCostUsd).toBeGreaterThan(0)
  })

  it('treats a picked side with a tie margin as a tie', async () => {
    const { verdict } = await run([
      { winner: 'output_1', margin: 'tie' },
      { winner: 'output_2', margin: 'tie' },
    ])
    expect(verdict.winner).toBe('tie')
    expect(verdict.flipped).toBe(false)
  })
})
