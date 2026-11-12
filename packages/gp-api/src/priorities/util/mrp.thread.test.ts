import { describe, expect, it } from 'vitest'
import {
  estimateMrp,
  MAX_MRP_CELLS,
  MrpFrameTooLargeError,
  type MrpAnswerCell,
  type MrpFrameCell,
} from './mrp.util'
import { estimateMrpOnThread } from './mrp.thread'

const AGES = ['18to24', '25to34', '35to44', '45to54', '55to64', '65plus']
const GENDERS = ['female', 'male']

const frameOf = (tracts: number): MrpFrameCell[] =>
  Array.from({ length: tracts }, (_, t) => `t${t}`).flatMap((tract) =>
    AGES.flatMap((age) =>
      GENDERS.map((gender) => ({
        count: 40,
        values: { tract, age, gender },
      })),
    ),
  )

const answersOf = (frame: MrpFrameCell[]): MrpAnswerCell[] =>
  frame
    .filter((_, index) => index % 3 === 0)
    .map((cell, index) => ({
      yes: index % 2,
      answers: 2,
      values: cell.values,
    }))

describe('estimateMrpOnThread', () => {
  it('reads what estimateMrp reads', async () => {
    const frame = frameOf(10)
    const answers = answersOf(frame)

    expect(await estimateMrpOnThread(answers, frame)).toEqual(
      estimateMrp(answers, frame, {}),
    )
  })

  it('leaves the event loop free while it fits', async () => {
    const frame = frameOf(120)
    const answers = answersOf(frame)
    let ticks = 0
    const timer = setInterval(() => ticks++, 5)

    const started = Date.now()
    await estimateMrpOnThread(answers, frame)
    const took = Date.now() - started
    clearInterval(timer)

    expect(ticks).toBeGreaterThan(Math.floor(took / 5 / 4))
  })

  it('refuses a frame past the ceiling as estimateMrp does', async () => {
    const frame = Array.from({ length: MAX_MRP_CELLS + 1 }, (_, i) => ({
      count: 1,
      values: { tract: `t${i}` },
    }))

    await expect(estimateMrpOnThread([], frame)).rejects.toBeInstanceOf(
      MrpFrameTooLargeError,
    )
  })

  it('stops the fit when aborted', async () => {
    const controller = new AbortController()
    const fit = estimateMrpOnThread(
      answersOf(frameOf(120)),
      frameOf(120),
      controller.signal,
    )
    controller.abort(new Error('shutting down'))

    await expect(fit).rejects.toThrow('shutting down')
  })
})
