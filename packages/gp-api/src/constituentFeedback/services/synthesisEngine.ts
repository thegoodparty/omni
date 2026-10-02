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
