'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Badge, Button, cn } from '@styleguide'
import {
  ArrowLeftIcon,
  FlagIcon,
  SparklesIcon,
} from '@styleguide/components/ui/icons'
import type { Ordinance } from '@goodparty_org/contracts'
import { updateOrdinance } from '../data/ordinances-api'
import { ORDINANCE_STATUS_META } from '../data/statuses'
import DraftChat, { type DraftChatHandle } from './DraftChat'

const AUTOSAVE_DELAY_MS = 800

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const SAVE_LABEL: Record<SaveState, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  error: "Couldn't save",
}

type Selection = { text: string; top: number; left: number }

export default function DraftDetail({
  ordinance,
}: {
  ordinance: Ordinance
}): React.JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chatRef = useRef<DraftChatHandle>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [selection, setSelection] = useState<Selection | null>(null)

  const title =
    ordinance.draftTitle ?? ordinance.goalText ?? 'Untitled ordinance'
  const statusMeta = ORDINANCE_STATUS_META[ordinance.status]

  // Uncontrolled contentEditable: seed once on mount from the saved body so
  // typing never resets the caret. The saved body is the source of truth from
  // here on, so we don't re-sync from props after mount.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.innerText = ordinance.draftBody ?? ''
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = useCallback(
    (body: string) => {
      setSaveState('saving')
      updateOrdinance(ordinance.slug, { draftBody: body })
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'))
    },
    [ordinance.slug],
  )

  const onInput = useCallback((): void => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const body = bodyRef.current?.innerText ?? ''
    timerRef.current = setTimeout(() => save(body), AUTOSAVE_DELAY_MS)
  }, [save])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  // Show the ask/flag toolbar when the user selects text inside the draft body.
  useEffect(() => {
    const onSelectionChange = (): void => {
      const sel = window.getSelection()
      const editor = bodyRef.current
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !editor) {
        setSelection(null)
        return
      }
      const range = sel.getRangeAt(0)
      const text = sel.toString().trim()
      if (!text || !editor.contains(range.commonAncestorContainer)) {
        setSelection(null)
        return
      }
      const rect = range.getBoundingClientRect()
      setSelection({ text, top: rect.top, left: rect.left + rect.width / 2 })
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () =>
      document.removeEventListener('selectionchange', onSelectionChange)
  }, [])

  const seedChat = useCallback((composerText: string): void => {
    chatRef.current?.seed(composerText)
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }, [])

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Link
          href="/dashboard/ordinances"
          aria-label="Back to ordinances"
          className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted"
        >
          <ArrowLeftIcon className="size-4" aria-hidden />
        </Link>
        <h1 className="text-base font-semibold text-foreground">
          Draft details
        </h1>
        <div className="ml-auto flex items-center gap-3">
          {saveState !== 'idle' ? (
            <span
              className={cn(
                'text-xs',
                saveState === 'error'
                  ? 'text-destructive'
                  : 'text-muted-foreground',
              )}
            >
              {SAVE_LABEL[saveState]}
            </span>
          ) : null}
          <Badge className={cn('rounded-full', statusMeta.pillClass)}>
            {statusMeta.label}
          </Badge>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-y-auto p-6">
          <h2 className="mb-4 text-xl font-bold text-foreground">{title}</h2>
          <div
            ref={bodyRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Ordinance draft body"
            onInput={onInput}
            className="min-h-40 whitespace-pre-wrap text-sm leading-relaxed text-foreground outline-none"
          />
        </div>

        <div className="border-t border-border">
          <div className="mx-auto flex h-72 w-full max-w-3xl flex-col p-4">
            <DraftChat ref={chatRef} ordinance={ordinance} />
          </div>
        </div>
      </div>

      {selection ? (
        <div
          role="toolbar"
          aria-label="Selection actions"
          className="fixed z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card p-1 shadow-md"
          style={{ top: Math.max(8, selection.top - 48), left: selection.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <Button
            type="button"
            size="small"
            onClick={() =>
              seedChat(`About this passage: "${selection.text}"\n\n`)
            }
          >
            <SparklesIcon className="size-3.5" aria-hidden />
            Ask about this
          </Button>
          <Button
            type="button"
            size="small"
            variant="outline"
            onClick={() =>
              seedChat(
                `I think there's a problem with this passage: "${selection.text}"\n\n`,
              )
            }
          >
            <FlagIcon className="size-3.5" aria-hidden />
            Flag a bug
          </Button>
        </div>
      ) : null}
    </div>
  )
}
