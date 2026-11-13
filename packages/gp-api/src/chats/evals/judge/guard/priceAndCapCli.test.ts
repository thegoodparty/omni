import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { main } from './priceAndCapCli'

const OUTPUT_LINE = /^(\w+)<<(ghadelim_\w+)\n([\s\S]*?)\n\2$/gm

const run = (env: {
  floor: string
  finalAgents: string
}): Record<string, string> => {
  const outputFile = path.join(
    mkdtempSync(path.join(tmpdir(), 'price-and-cap-')),
    'output',
  )
  vi.stubEnv('GUARD_FLOOR', env.floor)
  vi.stubEnv('GUARD_FINAL_AGENTS', env.finalAgents)
  vi.stubEnv('GUARD_SPENT_SO_FAR_CENTS', '0')
  vi.stubEnv('GITHUB_OUTPUT', outputFile)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  main()
  const outputs: Record<string, string> = {}
  for (const match of readFileSync(outputFile, 'utf8').matchAll(OUTPUT_LINE)) {
    outputs[match[1] ?? ''] = match[3] ?? ''
  }
  return outputs
}

describe('priceAndCapCli', () => {
  it('never prices or runs an agent the judge cannot sweep', () => {
    const outputs = run({
      floor: 'campaign_assistant',
      finalAgents: 'campaign_assistant,compliance_setup',
    })
    expect(outputs.agents_to_run).toBe('campaign_assistant')
    expect(outputs.cap_note).toContain('`campaign_assistant`')
    expect(outputs.cap_note).toContain(
      'Not swept, because the judge cannot sweep them: `compliance_setup` ' +
        '(blocked from judging).',
    )
  })

  it('filters the raw floor the workflow falls back to', () => {
    const outputs = run({
      floor: 'compliance_setup',
      finalAgents: 'compliance_setup',
    })
    expect(outputs.agents_to_run).toBe('')
    expect(outputs.scope).not.toBe('none')
    expect(outputs.cap_note).toBe(
      'No agent reached. Not swept, because the judge cannot sweep them: ' +
        '`compliance_setup` (blocked from judging).',
    )
  })

  it('says only that no agent was reached for an empty set', () => {
    const outputs = run({ floor: '', finalAgents: '' })
    expect(outputs.agents_to_run).toBe('')
    expect(outputs.cap_note).toBe('No agent reached.')
  })
})
