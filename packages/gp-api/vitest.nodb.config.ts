import baseConfig from './vitest.config'

const cfg = baseConfig as Record<string, any>

// vitest.config.ts sets `test.env` from .env.test, and that replaces the
// ambient environment rather than filling gaps in it. For the normal suite
// that is correct: the stub credentials in .env.test are what stop a unit
// test reaching a real provider by accident.
//
// It is wrong for this bench, which has to reach Anthropic and Braintrust for
// real. On a laptop the eval file papers over it by loading .env with
// override at import time, so the stub never survives. CI has no .env, so the
// stub stood and every model call failed with AI_NoOutputGeneratedError.
//
// Real values present in the environment are layered back over the stubs.
// Nothing is introduced that was not already exported, and locally this is a
// no-op because the eval's own .env override still runs afterwards.
const PASS_THROUGH = ['ANTHROPIC_API_KEY', 'BRAINTRUST_API_KEY'] as const

const ambient = Object.fromEntries(
  PASS_THROUGH.filter((k) => process.env[k]).map((k) => [k, process.env[k]]),
)

export default {
  ...cfg,
  test: {
    ...cfg.test,
    globalSetup: [],
    env: { ...cfg.test?.env, ...ambient },
  },
}
