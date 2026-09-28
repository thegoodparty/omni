'use client'

import { useCallback, useRef, useState } from 'react'
import type { CardSpec, ToolRun } from '../script'

export type LiveTool = ToolRun & { running: boolean }

export type Phase = 'thinking' | 'tools' | 'streaming' | 'done'

export type Turn =
  | { id: string; role: 'user'; text: string }
  | {
      id: string
      role: 'agent'
      text: string
      /** How much of `text` is on screen. */
      revealed: number
      tools: LiveTool[]
      card: CardSpec
      phase: Phase
    }

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/** Characters revealed per tick, and the tick length. */
const STEP = 3
const TICK = 12

type PlayArgs = {
  tools?: ToolRun[]
  text: string
  card?: CardSpec
  /** Skip the opening pause, for an acknowledgement that should land fast. */
  immediate?: boolean
}

/**
 * The conversation, played back with enough latency to feel like a model:
 * a pause to think, tool pills that run and resolve one at a time, then text
 * that types itself, then the card. Nothing here talks to a network.
 */
export const useConversation = (): {
  turns: Turn[]
  busy: boolean
  say: (text: string) => void
  play: (args: PlayArgs) => Promise<void>
  reset: () => void
} => {
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  // A play() runs as a chain of awaited sleeps, so a second one started before
  // the first finished would interleave: the older chain's final setBusy(false)
  // would clear the flag while the newer one is still streaming. Every play
  // takes a generation, and only the newest is allowed to touch state. reset()
  // bumps it too, which is what makes reset an actual cancel.
  const gen = useRef(0)

  const say = useCallback((text: string): void => {
    seq.current += 1
    setTurns((prev) => [
      ...prev,
      { id: `u-${seq.current}`, role: 'user', text },
    ])
  }, [])

  const play = useCallback(async (args: PlayArgs): Promise<void> => {
    seq.current += 1
    gen.current += 1
    const mine = gen.current
    const alive = (): boolean => gen.current === mine
    const id = `a-${seq.current}`
    const tools = args.tools ?? []
    const card: CardSpec = args.card ?? { kind: 'none' }

    setBusy(true)
    setTurns((prev) => [
      ...prev,
      {
        id,
        role: 'agent',
        text: args.text,
        revealed: 0,
        tools: [],
        card: { kind: 'none' },
        phase: 'thinking',
      },
    ])

    const patch = (fn: (t: Extract<Turn, { role: 'agent' }>) => Turn): void => {
      if (!alive()) return
      setTurns((prev) =>
        prev.map((t) => (t.id === id && t.role === 'agent' ? fn(t) : t)),
      )
    }

    await sleep(args.immediate ? 260 : 700)

    for (let k = 0; k < tools.length; k += 1) {
      const tool = tools[k]
      if (!tool) continue
      patch((t) => ({
        ...t,
        phase: 'tools',
        tools: [...t.tools, { ...tool, running: true }],
      }))
      await sleep(tool.ms)
      patch((t) => ({
        ...t,
        tools: t.tools.map((tt, i) =>
          i === k ? { ...tt, running: false } : tt,
        ),
      }))
      await sleep(170)
    }

    patch((t) => ({ ...t, phase: 'streaming' }))

    const total = args.text.length
    for (let i = 0; i <= total; i += STEP) {
      const at = Math.min(i, total)
      patch((t) => ({ ...t, revealed: at }))
      await sleep(TICK)
    }

    patch((t) => ({ ...t, revealed: total, phase: 'done', card }))
    if (alive()) setBusy(false)
  }, [])

  const reset = useCallback((): void => {
    // Bumping the generation orphans any play() still walking its sleep chain,
    // so nothing it does after this lands.
    gen.current += 1
    setTurns([])
    setBusy(false)
    seq.current = 0
  }, [])

  return { turns, busy, say, play, reset }
}
