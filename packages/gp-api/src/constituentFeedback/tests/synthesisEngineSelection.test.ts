import { afterEach, describe, expect, it, vi } from 'vitest'
import { readMockGrouping } from '../services/mockSynthesisEngine'
import {
  selectSynthesisEngine,
  type SynthesisEngine,
} from '../services/synthesisEngine'

const engine = (name: string): SynthesisEngine => ({
  name,
  start: async () => undefined,
})

const engines = { mock: engine('mock'), pipeline: engine('v1_pipeline') }

describe('synthesis engine selection', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('runs the pipeline when unset or empty', () => {
    vi.stubEnv('FEEDBACK_SYNTHESIS_ENGINE', '')
    expect(selectSynthesisEngine(engines)).toBe(engines.pipeline)
  })

  it('selects each engine by name', () => {
    vi.stubEnv('FEEDBACK_SYNTHESIS_ENGINE', 'mock')
    expect(selectSynthesisEngine(engines)).toBe(engines.mock)
    vi.stubEnv('FEEDBACK_SYNTHESIS_ENGINE', 'pipeline')
    expect(selectSynthesisEngine(engines)).toBe(engines.pipeline)
  })

  // A typo must not quietly hand a laptop's memos to the deployed pipeline.
  it('refuses any other engine at boot', () => {
    vi.stubEnv('FEEDBACK_SYNTHESIS_ENGINE', 'mok')
    expect(() => selectSynthesisEngine(engines)).toThrow(
      /FEEDBACK_SYNTHESIS_ENGINE must be "mock" or "pipeline", got "mok"/,
    )
  })

  it('reads the mock grouping, defaulting to the model', () => {
    vi.stubEnv('FEEDBACK_SYNTHESIS_MOCK_GROUPING', '')
    expect(readMockGrouping()).toBe('llm')
    vi.stubEnv('FEEDBACK_SYNTHESIS_MOCK_GROUPING', 'canned')
    expect(readMockGrouping()).toBe('canned')
  })

  it('refuses any other mock grouping', () => {
    vi.stubEnv('FEEDBACK_SYNTHESIS_MOCK_GROUPING', 'random')
    expect(() => readMockGrouping()).toThrow(
      /FEEDBACK_SYNTHESIS_MOCK_GROUPING must be "llm" or "canned"/,
    )
  })
})
