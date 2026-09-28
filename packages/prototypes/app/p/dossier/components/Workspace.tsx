'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HEARD_AFTER_SEND, INITIAL_SECTIONS, type Section } from '../data'
import { BEATS, OPENING, SENT_ACK, settledAck, type Beat } from '../script'
import { useConversation } from '../hooks/useConversation'
import { ChatView } from './ChatView'
import { DossierView } from './DossierView'

export type Mode = 'chat' | 'file'

/**
 * One thread, two views.
 *
 * Every piece of state lives here, so moving between the chat and the file is
 * a change of view and never a change of context: marking a section settled in
 * the file shows up in the chat, and sending the outreach from the chat writes
 * into the file. That is the whole argument the prototype exists to make.
 */
export const Workspace = (): React.JSX.Element => {
  const [mode, setMode] = useState<Mode>('chat')
  const [sections, setSections] = useState<Section[]>(INITIAL_SECTIONS)
  const [played, setPlayed] = useState<string[]>([])
  const [outreachSent, setOutreachSent] = useState(false)
  const [sending, setSending] = useState(false)
  const outreachTimer = useRef<number | null>(null)
  const { turns, busy, say, play, reset } = useConversation()

  // A pending send must not outlive the component either.
  useEffect(
    () => () => {
      if (outreachTimer.current !== null) {
        window.clearTimeout(outreachTimer.current)
      }
    },
    [],
  )

  // The opening turn, once.
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    void play({ text: OPENING, immediate: true })
  }, [play])

  const settledCount = sections.filter((s) => s.state === 'settled').length

  // The first beat is always offered; the rest unlock as earlier ones land.
  const suggestions = useMemo<Beat[]>(() => {
    const unlocked = new Set<string>(['where'])
    for (const id of played) {
      const beat = BEATS.find((b) => b.id === id)
      for (const next of beat?.unlocks ?? []) unlocked.add(next)
    }
    return BEATS.filter((b) => unlocked.has(b.id) && !played.includes(b.id))
  }, [played])

  const runBeat = useCallback(
    (beat: Beat): void => {
      if (busy) return
      say(beat.prompt)
      setPlayed((prev) => [...prev, beat.id])
      void play({ tools: beat.tools, text: beat.text, card: beat.card })
    },
    [busy, say, play],
  )

  const markSettled = useCallback(
    (id: string): void => {
      const target = sections.find((s) => s.id === id)
      if (!target || target.state === 'settled') return
      const after = sections.map((s) =>
        s.id === id ? { ...s, state: 'settled' as const } : s,
      )
      setSections(after)
      // The acknowledgement reads off the state AFTER this settlement, so it
      // stays true whichever section was marked and however many are left.
      const open = after.filter((s) => s.state !== 'settled')
      void play({
        text: settledAck(
          target.label,
          open.length,
          open.some((s) => s.id === 'authority'),
        ),
        immediate: true,
      })
    },
    [sections, play],
  )

  const sendOutreach = useCallback((): void => {
    if (outreachSent || sending) return
    setSending(true)
    outreachTimer.current = window.setTimeout(() => {
      outreachTimer.current = null
      setSending(false)
      setOutreachSent(true)
      setSections((prev) =>
        prev.map((s) =>
          s.id === 'heard'
            ? {
                ...s,
                state: 'working',
                body: HEARD_AFTER_SEND,
                source: 'Sent from this conversation',
              }
            : s,
        ),
      )
      void play({ text: SENT_ACK, immediate: true })
    }, 1400)
  }, [outreachSent, sending, play])

  const resetAll = useCallback((): void => {
    // The send lands on a timer, and its callback writes sections and
    // outreachSent directly rather than through play(), so the generation
    // guard does not cover it. Without this the callback fires into the fresh
    // conversation and re-sends outreach nobody asked for.
    if (outreachTimer.current !== null) {
      window.clearTimeout(outreachTimer.current)
      outreachTimer.current = null
    }
    reset()
    setSections(INITIAL_SECTIONS)
    setPlayed([])
    setOutreachSent(false)
    setSending(false)
    setMode('chat')
    opened.current = false
  }, [reset])

  // Re-fire the opening after a reset, once the transcript is actually empty.
  useEffect(() => {
    if (opened.current || turns.length > 0) return
    opened.current = true
    void play({ text: OPENING, immediate: true })
  }, [turns.length, play])

  return mode === 'file' ? (
    <DossierView
      sections={sections}
      settledCount={settledCount}
      busy={busy}
      onMarkSettled={markSettled}
      onBackToChat={() => setMode('chat')}
    />
  ) : (
    <ChatView
      turns={turns}
      busy={busy}
      suggestions={suggestions}
      settledCount={settledCount}
      totalSections={sections.length}
      outreachSent={outreachSent}
      sending={sending}
      onSuggest={runBeat}
      onOpenFile={() => setMode('file')}
      onSendOutreach={sendOutreach}
      onReset={resetAll}
    />
  )
}
