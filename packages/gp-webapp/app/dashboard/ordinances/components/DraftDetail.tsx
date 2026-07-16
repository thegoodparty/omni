'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import Link from 'next/link'
import {
  Badge,
  Button,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  IconButton,
  cn,
} from '@styleguide'
import {
  ArrowLeftIcon,
  FlagIcon,
  SparklesIcon,
} from '@styleguide/components/ui/icons'
import { AiIcon } from '@styleguide/components/ui/ai-icon'
import type {
  Ordinance,
  UpdateOrdinanceRequest,
} from '@goodparty_org/contracts'
import ChatPill from '../../shared/ai-chat/ChatPill'
import { updateOrdinance } from '../data/ordinances-api'
import { ORDINANCE_STATUS_META } from '../data/statuses'
import DraftChat from './DraftChat'
import QualityReport from './QualityReport'
import SourceLine from './SourceLine'

const AUTOSAVE_DELAY_MS = 800

// useLayoutEffect on the client, useEffect on the server (avoids the SSR
// "useLayoutEffect does nothing on the server" warning). We need the layout
// variant so the unmount cleanup runs during React's commit phase, while the
// editor node is still in the DOM.
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

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
  const titleRef = useRef<HTMLHeadingElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bodyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingRef = useRef(false)
  const queuedRef = useRef<UpdateOrdinanceRequest | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [selection, setSelection] = useState<Selection | null>(null)
  // True once the draft is edited this session, so the quality report can show
  // a stale banner without refetching. Cleared when a fresh report is run.
  const [draftDirty, setDraftDirty] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  // The composer seed for the chat drawer, plus a nonce so re-highlighting the
  // same passage re-seeds even when the text is identical.
  const [chatSeed, setChatSeed] = useState('')
  const [seedNonce, setSeedNonce] = useState(0)

  const title =
    ordinance.draftTitle ?? ordinance.goalText ?? 'Untitled ordinance'
  const statusMeta = ORDINANCE_STATUS_META[ordinance.status]
  const sources = ordinance.draftSources ?? []

  // Uncontrolled contentEditable fields: seed once on mount so typing never
  // resets the caret. The saved values are the source of truth from here on, so
  // we don't re-sync from props after mount.
  useEffect(() => {
    if (titleRef.current) titleRef.current.innerText = title
    if (bodyRef.current) bodyRef.current.innerText = ordinance.draftBody ?? ''
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Serialize saves so two PATCHes never race: at most one is in flight, and the
  // newest edit made while it runs is queued (merged across fields) and fired on
  // completion. Last edit wins rather than last response, so an out-of-order
  // PATCH can't persist stale text.
  const save = useCallback(
    (update: UpdateOrdinanceRequest): void => {
      if (Object.keys(update).length === 0) return
      if (savingRef.current) {
        queuedRef.current = { ...queuedRef.current, ...update }
        return
      }
      savingRef.current = true
      setSaveState('saving')
      updateOrdinance(ordinance.slug, update)
        .then(() => setSaveState('saved'))
        .catch(() => {
          // Drop the queued edit on failure so the error state stays visible (a
          // queued retry would immediately flip back to 'saving') and we don't
          // spin an unbounded retry loop; the next edit re-triggers a save.
          setSaveState('error')
          queuedRef.current = null
        })
        .finally(() => {
          savingRef.current = false
          const queued = queuedRef.current
          queuedRef.current = null
          if (queued && Object.keys(queued).length > 0) save(queued)
        })
    },
    [ordinance.slug],
  )

  // Read innerText only when typing pauses, not on every keystroke (each read
  // forces a synchronous layout reflow). Empty fields are skipped: the contract
  // requires draftTitle/draftBody be non-empty, so gp-api 400s on ''.
  const onBodyInput = useCallback((): void => {
    setDraftDirty(true)
    if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current)
    bodyTimerRef.current = setTimeout(() => {
      bodyTimerRef.current = null
      const body = bodyRef.current?.innerText ?? ''
      if (body.trim().length > 0) save({ draftBody: body })
    }, AUTOSAVE_DELAY_MS)
  }, [save])

  const onTitleInput = useCallback((): void => {
    setDraftDirty(true)
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
    titleTimerRef.current = setTimeout(() => {
      titleTimerRef.current = null
      const next = titleRef.current?.innerText.trim() ?? ''
      if (next.length > 0) save({ draftTitle: next })
    }, AUTOSAVE_DELAY_MS)
  }, [save])

  // Flush pending debounced edits on unmount so leaving the screen (the Back
  // link, sidebar nav, or browser back) never drops the last change. The layout
  // cleanup runs during React's commit while the editor nodes are still mounted,
  // so we can read their live text; a passive-effect (useEffect) cleanup would
  // run after the nodes are detached, when innerText reads empty. Only fields
  // with a pending timer are flushed, so an untouched field is never re-sent.
  useIsomorphicLayoutEffect(() => {
    const titleNode = titleRef.current
    const bodyNode = bodyRef.current
    return () => {
      const update: UpdateOrdinanceRequest = {}
      if (bodyTimerRef.current) {
        clearTimeout(bodyTimerRef.current)
        bodyTimerRef.current = null
        const body = bodyNode?.innerText ?? ''
        if (body.trim().length > 0) update.draftBody = body
      }
      if (titleTimerRef.current) {
        clearTimeout(titleTimerRef.current)
        titleTimerRef.current = null
        const next = titleNode?.innerText.trim() ?? ''
        if (next.length > 0) update.draftTitle = next
      }
      if (Object.keys(update).length > 0) save(update)
    }
  }, [save])

  // Position the ask/flag toolbar at the selection inside the draft body.
  // Recompute on selection change and on scroll of the editor's overflow
  // container: scrolling moves the selected text without firing selectionchange,
  // so that alone would leave the toolbar pinned to a stale viewport position.
  useEffect(() => {
    const updatePosition = (): void => {
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
    // Coalesce scroll events to one reposition per frame (getBoundingClientRect
    // + setSelection forces a reflow; scroll can fire many times per frame).
    let rafId = 0
    const onScroll = (): void => {
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        updatePosition()
      })
    }
    const scrollContainer = scrollRef.current
    document.addEventListener('selectionchange', updatePosition)
    scrollContainer?.addEventListener('scroll', onScroll)
    return () => {
      document.removeEventListener('selectionchange', updatePosition)
      scrollContainer?.removeEventListener('scroll', onScroll)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [])

  // Open the chat drawer, optionally seeding the composer from a highlighted
  // passage. Bumps the nonce so the drawer re-seeds each time it opens. Always
  // clears any active selection so the selection toolbar doesn't linger over the
  // opening drawer (this fires whether opened from the launcher or a toolbar
  // button).
  const openChat = useCallback((seed = ''): void => {
    setChatSeed(seed)
    setSeedNonce((n) => n + 1)
    setChatOpen(true)
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
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl p-6">
            <h2
              ref={titleRef}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label="Ordinance draft title"
              onInput={onTitleInput}
              className="mb-4 text-xl font-bold text-foreground outline-none"
            />
            <div
              ref={bodyRef}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label="Ordinance draft body"
              onInput={onBodyInput}
              className="min-h-40 whitespace-pre-wrap text-base leading-relaxed text-foreground outline-none"
            />
            {sources.length > 0 ? (
              <div className="mt-8 border-t border-border pt-4">
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Sources
                </h3>
                <div className="flex flex-col gap-2">
                  {sources.map((source, i) => (
                    <SourceLine key={`${source.id}-${i}`} source={source} />
                  ))}
                </div>
              </div>
            ) : null}

            <QualityReport
              slug={ordinance.slug}
              initialReport={ordinance.qualityReport}
              draftDirty={draftDirty}
              onReran={() => setDraftDirty(false)}
              onDiscussFinding={(check) =>
                openChat(`About the "${check.label}" check: ${check.note}\n\n`)
              }
            />
          </div>
        </div>

        <div className="sticky bottom-0 z-10 border-t border-border bg-background">
          <div className="mx-auto w-full max-w-3xl p-4">
            <ChatPill className="w-full" innerClassName="items-center">
              <button
                type="button"
                onClick={() => openChat()}
                className="flex-1 truncate rounded-full pl-2.5 text-left text-sm font-medium text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary-focus focus-visible:outline-none"
              >
                Ask about this draft...
              </button>
              <IconButton
                type="button"
                size="medium"
                aria-label="Ask about this draft"
                className="bg-primary text-primary-foreground"
                onClick={() => openChat()}
              >
                <AiIcon className="size-4" aria-hidden />
              </IconButton>
            </ChatPill>
          </div>
        </div>
      </div>

      <Drawer open={chatOpen} onOpenChange={setChatOpen} direction="bottom">
        <DrawerContent className="h-[85vh] data-[vaul-drawer-direction=bottom]:max-h-[90vh]">
          <DrawerHeader className="border-b border-border px-4 py-3 text-left">
            <DrawerTitle className="text-base font-semibold">
              Chat about this draft
            </DrawerTitle>
            <DrawerDescription className="sr-only">
              Ask the agent about this ordinance draft.
            </DrawerDescription>
          </DrawerHeader>
          <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 pb-4 pt-3">
            <DraftChat
              ordinance={ordinance}
              seedText={chatSeed}
              seedNonce={seedNonce}
            />
          </div>
        </DrawerContent>
      </Drawer>

      {selection && !chatOpen ? (
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
              openChat(`About this passage: "${selection.text}"\n\n`)
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
              openChat(
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
