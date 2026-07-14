'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Badge, cn } from '@styleguide'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import type { Ordinance } from '@goodparty_org/contracts'
import { updateOrdinance } from '../data/ordinances-api'
import { ORDINANCE_STATUS_META } from '../data/statuses'

const AUTOSAVE_DELAY_MS = 800

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const SAVE_LABEL: Record<SaveState, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  error: "Couldn't save",
}

export default function DraftDetail({
  ordinance,
}: {
  ordinance: Ordinance
}): React.JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')

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
        <h1 className="text-base font-semibold text-foreground">Draft details</h1>
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

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto p-6">
        <h2 className="text-xl font-bold text-foreground">{title}</h2>
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
    </div>
  )
}
