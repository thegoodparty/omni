import { parentPort, workerData } from 'node:worker_threads'
import {
  estimateMrp,
  MrpFrameTooLargeError,
  type MrpAnswerCell,
  type MrpFrameCell,
} from './mrp.util'
import type { MrpThreadReply } from './mrp.thread'

// A worker thread's entry: one estimateMrp, posted back to mrp.thread.ts.
const { answers, frame } = workerData as {
  answers: MrpAnswerCell[]
  frame: MrpFrameCell[]
}

// An Error crosses the thread as a plain Error, so the one the caller acts
// on is sent as data.
const reply = ((): MrpThreadReply => {
  try {
    return { result: estimateMrp(answers, frame, {}) }
  } catch (err) {
    if (!(err instanceof MrpFrameTooLargeError)) throw err
    return { tooLarge: { cells: err.cells, parameters: err.parameters } }
  }
})()
parentPort?.postMessage(reply)
