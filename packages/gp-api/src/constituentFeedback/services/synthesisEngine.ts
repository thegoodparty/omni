import type { FeedbackSynthesisRun } from '@/generated/prisma'

export const SYNTHESIS_ENGINE = Symbol('SYNTHESIS_ENGINE')

export type SynthesisMemo = {
  id: string
  text: string
  occurredAt: Date
}

// Hands a running run's confirmed memos to whatever groups them. Both
// engines finish the same way: a `feedbackSynthesisComplete` event into
// FeedbackSynthesisIngestService.handle, which is the only code that writes
// themes, members and tags. So a local run with the mock exercises the
// exact write path the deployed pipeline does.
//
// start() never throws. An engine that cannot hand the run off marks it
// failed itself, so the scope's activeKey is freed for the next request.
export type SynthesisEngine = {
  readonly name: string
  start(run: FeedbackSynthesisRun, memos: SynthesisMemo[]): Promise<void>
}

// Read once at boot. Unset means the deployed pipeline. Any other value is a
// typo that would otherwise quietly run the pipeline from a laptop, so boot
// refuses it.
export const selectSynthesisEngine = (engines: {
  mock: SynthesisEngine
  pipeline: SynthesisEngine
}): SynthesisEngine => {
  const value = process.env.FEEDBACK_SYNTHESIS_ENGINE || 'pipeline'
  if (value === 'mock') return engines.mock
  if (value === 'pipeline') return engines.pipeline
  throw new Error(
    `FEEDBACK_SYNTHESIS_ENGINE must be "mock" or "pipeline", got "${value}"`,
  )
}
