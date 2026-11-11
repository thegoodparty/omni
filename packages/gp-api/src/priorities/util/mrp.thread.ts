import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import {
  MrpFrameTooLargeError,
  type MrpAnswerCell,
  type MrpFrameCell,
  type MrpResult,
} from './mrp.util'

export type MrpThreadInput = {
  answers: MrpAnswerCell[]
  frame: MrpFrameCell[]
}

export type MrpThreadReply =
  | { result: MrpResult }
  | { tooLarge: { cells: number; parameters: number | null } }

// estimateMrp on its own thread, so a fit never holds the event loop that
// serves requests and runs every other job. One thread per fit: starting one
// costs tens of milliseconds, nothing next to the warehouse reads before it.
// Under tests the source is TypeScript, loaded through tsx; the build ships
// mrp.worker.js beside this file.
export const estimateMrpOnThread = (
  answers: MrpAnswerCell[],
  frame: MrpFrameCell[],
  signal?: AbortSignal,
): Promise<MrpResult> =>
  new Promise((resolve, reject) => {
    const typescript = __filename.endsWith('.ts')
    const worker = new Worker(
      join(__dirname, `mrp.worker.${typescript ? 'ts' : 'js'}`),
      {
        // Never the parent's: in prod that preloads OpenTelemetry.
        execArgv: typescript ? ['--import', 'tsx'] : [],
      },
    )
    let settled = false
    const settle = (finish: () => void): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      finish()
    }
    const abort = (): void => {
      settle(() => reject(signal?.reason ?? new Error('MRP fit aborted')))
      void worker.terminate()
    }
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
    worker.once('message', (reply: MrpThreadReply) =>
      settle(() =>
        'result' in reply
          ? resolve(reply.result)
          : reject(
              new MrpFrameTooLargeError(
                reply.tooLarge.cells,
                reply.tooLarge.parameters,
              ),
            ),
      ),
    )
    worker.once('error', (err) => settle(() => reject(err)))
    worker.postMessage({ answers, frame } satisfies MrpThreadInput)
    worker.once('exit', (code) =>
      settle(() => reject(new Error(`MRP thread exited with code ${code}`))),
    )
  })
