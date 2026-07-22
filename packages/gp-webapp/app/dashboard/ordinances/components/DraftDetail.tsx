'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Badge,
  Button,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  cn,
} from '@styleguide'
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  FileTextIcon,
  FlagIcon,
  LoaderCircleIcon,
  MicIcon,
  SparklesIcon,
  Trash2Icon,
} from '@styleguide/components/ui/icons'
import type {
  Ordinance,
  OrdinanceStatus,
  UpdateOrdinanceRequest,
} from '@goodparty_org/contracts'
import { useOrdinanceQualityLoopFlag } from '@shared/experiments/ordinanceQualityLoopFlag'
import { ConfirmDeleteDialog } from '../../shared/ConfirmDeleteDialog'
import ChatPill from '../../shared/ai-chat/ChatPill'
import {
  cancelQualityLoop,
  deleteOrdinance,
  downloadOrdinanceExport,
  fetchOrdinanceBySlug,
  updateOrdinance,
  type OrdinanceExportFormat,
} from '../data/ordinances-api'
import { ORDINANCE_STATUS_META, ORDINANCE_STATUS_ORDER } from '../data/statuses'
import DraftChat from './DraftChat'
import QualityReport from './QualityReport'
import SourceLine from './SourceLine'

// The statuses the user can set from the draft-detail pill. `in_progress` is the
// pre-draft state, so it isn't offered once a draft exists (matches Lovable).
const SELECTABLE_STATUSES: readonly OrdinanceStatus[] =
  ORDINANCE_STATUS_ORDER.filter((s) => s !== 'in_progress')

const AUTOSAVE_DELAY_MS = 800

// The improvement loop runs for minutes server-side; 5s keeps the pass/phase
// banner honest without hammering the API (house pattern: poll, no SSE).
const LOOP_POLL_MS = 5_000

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
  // The in-flight save's promise, so a flush can await the chain to settle.
  const savingPromiseRef = useRef<Promise<void> | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  // Whether the most recently settled save failed, set synchronously in save()'s
  // then/catch. A ref (not saveState) because it must be read reliably inside
  // flushPendingSaves right after the save promise settles — saveState's ref
  // mirror only updates on React's deferred re-render, which is too late here.
  const lastSaveFailedRef = useRef(false)
  const [selection, setSelection] = useState<Selection | null>(null)
  // True once the draft is edited this session, so the quality report can show
  // a stale banner without refetching. Cleared when a fresh report is run.
  const [draftDirty, setDraftDirty] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  // The composer seed for the chat drawer, plus a nonce so re-highlighting the
  // same passage re-seeds even when the text is identical.
  const [chatSeed, setChatSeed] = useState('')
  const [seedNonce, setSeedNonce] = useState(0)
  // Opened via the launcher's mic: start dictation as soon as the drawer's
  // chat mounts, so the user can talk without a second tap.
  const [autoDictate, setAutoDictate] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [status, setStatus] = useState<OrdinanceStatus>(ordinance.status)
  const [exportError, setExportError] = useState<string | null>(null)
  // Exposure-only read: the draft page IS the treatment surface (loop banner,
  // locked editor, What-changed panel), so mounting it must register Amplitude
  // exposure even though no UI branches on the flag here anymore — the loop
  // itself is server-gated on the same flag.
  useOrdinanceQualityLoopFlag()
  const [qualityLoop, setQualityLoop] = useState(ordinance.qualityLoop)
  // The report the loop last delivered (or the initial one). Keyed into
  // QualityReport so a mid-loop refresh actually replaces the rendered card.
  const [loopReport, setLoopReport] = useState(ordinance.qualityReport)
  const [stopping, setStopping] = useState(false)
  const [loopError, setLoopError] = useState<string | null>(null)
  const loopRunning = qualityLoop?.status === 'running'
  // Mirror for handlers that must read the live value outside React's render
  // (autosave input guards, the focus re-check, terminal detection).
  const loopRunningRef = useRef(loopRunning)
  useEffect(() => {
    loopRunningRef.current = loopRunning
  }, [loopRunning])

  // The editors' last serialization known to match the persisted draft, as
  // innerText reads it. contentEditable's innerText set/get round-trip is not
  // byte-identical (nbsp/newline normalization), so an input event can fire
  // with text that only *reserializes* the same content — saving it would
  // byte-shuffle the body, change the quality report's input hash, and stale
  // a fresh report (observed right after a loop reseed). Every save path
  // skips when the text equals this snapshot. Null forces the next save
  // through (after a failed PATCH the server copy is behind the snapshot).
  const lastSavedTitleRef = useRef<string | null>(null)
  const lastSavedBodyRef = useRef<string | null>(null)

  const router = useRouter()

  const seedEditorsFrom = useCallback((next: Ordinance): void => {
    if (titleRef.current) {
      titleRef.current.innerText =
        next.draftTitle ?? next.goalText ?? 'Untitled ordinance'
    }
    if (bodyRef.current) bodyRef.current.innerText = next.draftBody ?? ''
    // Snapshot the read-back (not the assigned string): the setter/getter
    // round-trip is the serialization future input events will produce.
    lastSavedTitleRef.current = titleRef.current?.innerText ?? null
    lastSavedBodyRef.current = bodyRef.current?.innerText ?? null
  }, [])

  // Bumped by any user action that changes loop/draft state (stop, restore):
  // a fetch that started before the bump carries a stale snapshot — applying
  // it would re-lock the editor as "running" after a stop, and the reseed
  // would wipe anything typed since the unlock. Guard every async consumer.
  const loopGenRef = useRef(0)

  // Fold a freshly fetched ordinance into the loop state. No-op when no loop
  // is involved (so a focus re-check never clobbers live edits). Reseeding
  // and autosave-cancelling only happen when the loop already owned the
  // editor (locked): on the not-running -> running discovery (a focus
  // re-check finding a loop started elsewhere) the editor is still editable,
  // so the user's typing is authoritative — reseeding would silently discard
  // it, and its pending autosave legitimately retires the young run through
  // the edit supersession hook.
  const applyLoopFetch = useCallback(
    (next: Ordinance): void => {
      const wasRunning = loopRunningRef.current
      const nowRunning = next.qualityLoop?.status === 'running'
      if (!wasRunning && !nowRunning) return
      setQualityLoop(next.qualityLoop)
      setLoopReport(next.qualityReport)
      if (wasRunning) {
        seedEditorsFrom(next)
        // The editors now hold the server truth the report was graded
        // against, so any earlier local dirtiness is moot — without this, a
        // loop-fresh report renders under a false stale banner.
        setDraftDirty(false)
        // The loop owns the draft: a debounced or queued autosave from
        // before this fetch carries pre-loop text — landing it would PATCH
        // over the loop's revision and supersede a healthy run.
        if (bodyTimerRef.current) {
          clearTimeout(bodyTimerRef.current)
          bodyTimerRef.current = null
        }
        if (titleTimerRef.current) {
          clearTimeout(titleTimerRef.current)
          titleTimerRef.current = null
        }
        queuedRef.current = null
      }
    },
    [seedEditorsFrom],
  )

  useEffect(() => {
    if (!loopRunning) return
    const timer = setInterval(() => {
      const gen = loopGenRef.current
      // A transient poll failure is ignored; the next tick retries.
      void fetchOrdinanceBySlug(ordinance.slug)
        .then((next) => {
          if (gen === loopGenRef.current) applyLoopFetch(next)
        })
        .catch(() => undefined)
    }, LOOP_POLL_MS)
    return () => clearInterval(timer)
  }, [loopRunning, ordinance.slug, applyLoopFetch])

  // A loop can be started from another tab (or by the saveDraft hook while
  // this page sat in a background tab). Re-check on focus/visibility so a
  // stale editable page can't clobber the loop's revisions.
  useEffect(() => {
    let inFlight = false
    const recheck = (): void => {
      if (inFlight || loopRunningRef.current) return
      if (document.visibilityState === 'hidden') return
      inFlight = true
      const gen = loopGenRef.current
      void fetchOrdinanceBySlug(ordinance.slug)
        .then((next) => {
          if (gen === loopGenRef.current) applyLoopFetch(next)
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false
        })
    }
    window.addEventListener('focus', recheck)
    document.addEventListener('visibilitychange', recheck)
    return () => {
      window.removeEventListener('focus', recheck)
      document.removeEventListener('visibilitychange', recheck)
    }
  }, [ordinance.slug, applyLoopFetch])

  const stopLoop = async (): Promise<void> => {
    setStopping(true)
    setLoopError(null)
    // Invalidate polls already in flight: their pre-cancel "running" snapshot
    // must not land after the cancel response unlocks the editor.
    loopGenRef.current += 1
    try {
      const next = await cancelQualityLoop(ordinance.slug)
      applyLoopFetch(next)
    } catch {
      setLoopError('Could not stop the improvements. Please try again.')
    } finally {
      setStopping(false)
    }
  }

  const handleExport = async (format: OrdinanceExportFormat): Promise<void> => {
    setExportError(null)
    try {
      await downloadOrdinanceExport(ordinance.slug, format)
    } catch {
      setExportError('Could not export the draft. Please try again.')
    }
  }

  const confirmDelete = async (): Promise<void> => {
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteOrdinance(ordinance.slug)
      // router.push doesn't synchronously unmount, so reset here — a lingering
      // deleting/open would otherwise lock the dialog in a spinner (or re-open
      // locked) during the nav window.
      setDeleting(false)
      setDeleteOpen(false)
      router.push('/dashboard/ordinances')
    } catch {
      setDeleting(false)
      setDeleteError('Could not delete the draft. Please try again.')
    }
  }

  // Optimistically reflect the picked status; revert if the save fails.
  const changeStatus = async (next: OrdinanceStatus): Promise<void> => {
    if (next === status) return
    const prev = status
    setStatus(next)
    try {
      await updateOrdinance(ordinance.slug, { status: next })
    } catch {
      setStatus(prev)
    }
  }

  const title =
    ordinance.draftTitle ?? ordinance.goalText ?? 'Untitled ordinance'
  const statusMeta = ORDINANCE_STATUS_META[status]
  const sources = ordinance.draftSources ?? []

  // Uncontrolled contentEditable fields: seed once on mount so typing never
  // resets the caret. The saved values are the source of truth from here on, so
  // we don't re-sync from props after mount.
  useEffect(() => {
    if (titleRef.current) titleRef.current.innerText = title
    if (bodyRef.current) bodyRef.current.innerText = ordinance.draftBody ?? ''
    // Baseline snapshot of the seeded read-back, so the very first input
    // event can already tell a real edit from a reserialization.
    lastSavedTitleRef.current = titleRef.current?.innerText ?? null
    lastSavedBodyRef.current = bodyRef.current?.innerText ?? null
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
      savingPromiseRef.current = updateOrdinance(ordinance.slug, update)
        .then(() => {
          setSaveState('saved')
          lastSaveFailedRef.current = false
        })
        .catch(() => {
          // Drop the queued edit on failure so the error state stays visible (a
          // queued retry would immediately flip back to 'saving') and we don't
          // spin an unbounded retry loop; the next edit re-triggers a save.
          setSaveState('error')
          lastSaveFailedRef.current = true
          queuedRef.current = null
          // The server copy is now behind the snapshot — clear it so the next
          // input (even a reserialization) saves instead of being skipped.
          lastSavedTitleRef.current = null
          lastSavedBodyRef.current = null
        })
        .finally(() => {
          savingRef.current = false
          const queued = queuedRef.current
          queuedRef.current = null
          if (queued && Object.keys(queued).length > 0) {
            save(queued)
          } else {
            savingPromiseRef.current = null
          }
        })
    },
    [ordinance.slug],
  )

  // Fire any pending debounced edits immediately and resolve once the save
  // chain (including a queued follow-up) has fully settled. Run before
  // generating the quality report so the LLM grades the latest saved text.
  const flushPendingSaves = useCallback(async (): Promise<void> => {
    const update: UpdateOrdinanceRequest = {}
    if (bodyTimerRef.current) {
      clearTimeout(bodyTimerRef.current)
      bodyTimerRef.current = null
      const body = bodyRef.current?.innerText ?? ''
      if (body !== lastSavedBodyRef.current && body.trim().length > 0) {
        lastSavedBodyRef.current = body
        update.draftBody = body
      }
    }
    if (titleTimerRef.current) {
      clearTimeout(titleTimerRef.current)
      titleTimerRef.current = null
      const raw = titleRef.current?.innerText ?? ''
      if (raw !== lastSavedTitleRef.current && raw.trim().length > 0) {
        lastSavedTitleRef.current = raw
        update.draftTitle = raw.trim()
      }
    }
    // If a prior save failed, the DB is stale and there may be no pending timer
    // to re-drive it. Re-send the current editor text so a run recovers from a
    // transient failure instead of dead-ending (we don't know which field
    // failed, so persist both).
    if (lastSaveFailedRef.current) {
      const body = bodyRef.current?.innerText ?? ''
      if (body.trim().length > 0) update.draftBody = body
      const next = titleRef.current?.innerText.trim() ?? ''
      if (next.length > 0) update.draftTitle = next
    }
    if (Object.keys(update).length > 0) save(update)
    while (savingRef.current && savingPromiseRef.current) {
      await savingPromiseRef.current
    }
    // Only abort if the draft still isn't saved after the attempt above — the
    // report would otherwise be graded against stale text.
    if (lastSaveFailedRef.current) {
      throw new Error('Draft could not be saved before running quality checks')
    }
  }, [save])

  // Read innerText only when typing pauses, not on every keystroke (each read
  // forces a synchronous layout reflow). Empty fields are skipped: the contract
  // requires draftTitle/draftBody be non-empty, so gp-api 400s on ''.
  const onBodyInput = useCallback((): void => {
    // The editor is locked while the loop runs; belt-and-braces mute the
    // autosave too so no stray input event PATCHes over a loop revision.
    if (loopRunningRef.current) return
    if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current)
    bodyTimerRef.current = setTimeout(() => {
      bodyTimerRef.current = null
      const body = bodyRef.current?.innerText ?? ''
      // Reserialized-but-identical text is not an edit: no save, and no
      // draftDirty — flagging it would stale a hash-fresh report the user
      // could only clear with a pointless paid re-grade.
      if (body === lastSavedBodyRef.current) return
      if (body.trim().length > 0) {
        setDraftDirty(true)
        lastSavedBodyRef.current = body
        save({ draftBody: body })
      }
    }, AUTOSAVE_DELAY_MS)
  }, [save])

  const onTitleInput = useCallback((): void => {
    if (loopRunningRef.current) return
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
    titleTimerRef.current = setTimeout(() => {
      titleTimerRef.current = null
      const raw = titleRef.current?.innerText ?? ''
      if (raw === lastSavedTitleRef.current) return
      const next = raw.trim()
      if (next.length > 0) {
        setDraftDirty(true)
        lastSavedTitleRef.current = raw
        save({ draftTitle: next })
      }
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
        if (body !== lastSavedBodyRef.current && body.trim().length > 0) {
          lastSavedBodyRef.current = body
          update.draftBody = body
        }
      }
      if (titleTimerRef.current) {
        clearTimeout(titleTimerRef.current)
        titleTimerRef.current = null
        const raw = titleNode?.innerText ?? ''
        if (raw !== lastSavedTitleRef.current && raw.trim().length > 0) {
          lastSavedTitleRef.current = raw
          update.draftTitle = raw.trim()
        }
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
  const openChat = useCallback((seed = '', dictate = false): void => {
    setChatSeed(seed)
    setSeedNonce((n) => n + 1)
    setAutoDictate(dictate)
    setChatOpen(true)
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }, [])

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <header className="border-b border-border py-3">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-6">
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
            <IconButton
              type="button"
              variant="outline"
              size="small"
              aria-label="Delete draft"
              onClick={() => setDeleteOpen(true)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Trash2Icon className="size-4" aria-hidden />
            </IconButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  type="button"
                  variant="outline"
                  size="small"
                  aria-label="Download draft"
                  className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <DownloadIcon className="size-4" aria-hidden />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => handleExport('pdf')}>
                  <FileTextIcon className="size-4" aria-hidden />
                  Download as PDF
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleExport('docx')}>
                  <FileTextIcon className="size-4" aria-hidden />
                  Download as Word
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {exportError ? (
        <div className="mx-auto w-full max-w-3xl px-6 pt-2">
          <p className="text-sm text-destructive">{exportError}</p>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl p-6">
            {loopRunning && qualityLoop ? (
              <div
                role="status"
                className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/50 px-4 py-3"
              >
                <LoaderCircleIcon
                  className="size-4 shrink-0 animate-spin text-muted-foreground"
                  aria-hidden
                />
                <span className="text-sm text-foreground">
                  {qualityLoop.phase === 'revising'
                    ? 'Rewriting flagged sections…'
                    : `Checking your draft (pass ${qualityLoop.passNumber}` +
                      ` of ${qualityLoop.maxPasses})`}
                </span>
                <Button
                  type="button"
                  size="small"
                  onClick={stopLoop}
                  disabled={stopping}
                  className="ml-auto rounded-full text-sm"
                >
                  Stop and edit
                </Button>
              </div>
            ) : null}
            {loopError ? (
              <p className="mb-4 text-sm text-destructive">{loopError}</p>
            ) : null}
            <div className="mb-4 flex justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="small"
                    aria-label="Change draft status"
                    className={cn(
                      'h-auto gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
                      statusMeta.pillClass,
                    )}
                  >
                    {statusMeta.label}
                    <ChevronDownIcon className="size-3.5" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {SELECTABLE_STATUSES.map((s) => {
                    const meta = ORDINANCE_STATUS_META[s]
                    return (
                      <DropdownMenuItem
                        key={s}
                        onSelect={() => changeStatus(s)}
                        className="gap-3"
                      >
                        <Badge className={cn('rounded-full', meta.pillClass)}>
                          {meta.label}
                        </Badge>
                        {s === status ? (
                          <CheckIcon
                            className="ml-auto size-4 text-foreground"
                            aria-hidden
                          />
                        ) : null}
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <h2
              ref={titleRef}
              contentEditable={!loopRunning}
              suppressContentEditableWarning
              role="textbox"
              aria-label="Ordinance draft title"
              aria-readonly={loopRunning ? 'true' : undefined}
              onInput={onTitleInput}
              className="mb-4 text-xl font-bold text-foreground outline-none"
            />
            <div
              ref={bodyRef}
              contentEditable={!loopRunning}
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label="Ordinance draft body"
              aria-readonly={loopRunning ? 'true' : undefined}
              onInput={onBodyInput}
              className="min-h-40 whitespace-pre-wrap text-base leading-relaxed text-foreground outline-none"
            />
            <QualityReport
              key={loopReport?.ranAgainstBodyHash ?? 'no-report'}
              slug={ordinance.slug}
              initialReport={loopReport}
              initialRunStatus={ordinance.qualityRunStatus}
              draftDirty={draftDirty}
              onBeforeRun={flushPendingSaves}
              loopRunning={loopRunning}
              onReran={() => {
                // Only clear the stale banner once the draft is safely
                // persisted: not while a save is in flight, not if the last
                // save failed, and not while an edit typed during the run is
                // still waiting on its debounce timer. All synchronous, so this
                // is reliable regardless of React's deferred re-render timing.
                const editPending =
                  bodyTimerRef.current !== null ||
                  titleTimerRef.current !== null
                if (
                  !savingRef.current &&
                  !lastSaveFailedRef.current &&
                  !editPending
                ) {
                  setDraftDirty(false)
                }
              }}
              onDiscussFinding={(check) =>
                openChat(`About the "${check.label}" check: ${check.note}\n\n`)
              }
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
          </div>
        </div>

        <div className="sticky bottom-0 z-10 border-t border-border bg-background">
          <div className="mx-auto w-full max-w-3xl p-4">
            {loopRunning ? (
              <p className="py-2 text-center text-sm text-muted-foreground">
                Improvements are running — stop them to edit or discuss
              </p>
            ) : (
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
                  variant="ghost"
                  aria-label="Dictate a message"
                  className="shrink-0"
                  onClick={() => openChat('', true)}
                >
                  <MicIcon className="size-5" aria-hidden />
                </IconButton>
                <IconButton
                  type="button"
                  size="medium"
                  aria-label="Ask about this draft"
                  className="shrink-0 bg-primary text-primary-foreground"
                  onClick={() => openChat()}
                >
                  <SparklesIcon className="size-5" aria-hidden />
                </IconButton>
              </ChatPill>
            )}
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
              autoDictate={autoDictate}
            />
          </div>
        </DrawerContent>
      </Drawer>

      {selection && !chatOpen && !loopRunning ? (
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

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open)
          // Drop a prior error so it doesn't linger on the next open.
          if (!open) setDeleteError(null)
        }}
        title="Delete this draft?"
        description="This removes the ordinance draft and its quality report from your ordinances. This can't be undone."
        confirmLabel="Delete draft"
        confirming={deleting}
        errorMessage={deleteError}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
