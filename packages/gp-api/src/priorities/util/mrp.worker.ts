import { parentPort } from 'node:worker_threads'
import { estimateMrp, MrpFrameTooLargeError } from './mrp.util'
import type { MrpThreadInput, MrpThreadReply } from './mrp.thread'

// A worker thread's entry: one estimateMrp, posted back to mrp.thread.ts.
// An Error crosses the thread as a plain Error, so the one the caller acts
// on is sent as data.
parentPort?.once('message', ({ answers, frame }: MrpThreadInput) => {
  const reply = ((): MrpThreadReply => {
    try {
      return { result: estimateMrp(answers, frame, {}) }
    } catch (err) {
      if (!(err instanceof MrpFrameTooLargeError)) throw err
      return { tooLarge: { cells: err.cells, parameters: err.parameters } }
    }
  })()
  parentPort?.postMessage(reply)
})
