'use client'

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import Link from 'next/link'
import type { Ordinance, OrdinanceSource } from '@goodparty_org/contracts'
import { fetchOrdinanceBySlug, updateOrdinance } from '../data/ordinances-api'
import SourceLine from './SourceLine'

const AUTOSAVE_MS = 500

// Source string (not a shared stateful /g instance) so isRedline and
// renderRedline each build their own regex and never trip over lastIndex.
const REDLINE_SOURCE = '\\{-([\\s\\S]+?)-\\}|\\{\\+([\\s\\S]+?)\\+\\}'

const isRedline = (body: string): boolean =>
  new RegExp(REDLINE_SOURCE).test(body)

// Render {-old-}{+new+} markup as <del>/<ins> so assistive tech announces the
// deletion/insertion (not just the visual strike/underline); plain fragments
// (with newlines) pass through the surrounding pre-wrap block.
const renderRedline = (text: string): React.ReactNode[] => {
  const regex = new RegExp(REDLINE_SOURCE, 'g')
  const parts: React.ReactNode[] = []
  let last = 0
  let key = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(
        <Fragment key={key++}>{text.slice(last, match.index)}</Fragment>,
      )
    }
    if (match[1] !== undefined) {
      parts.push(
        <del
          key={key++}
          className="rounded-sm bg-destructive/10 px-0.5 text-destructive line-through decoration-destructive/70"
        >
          {match[1]}
        </del>,
      )
    } else if (match[2] !== undefined) {
      parts.push(
        <ins
          key={key++}
          className="rounded-sm bg-success/10 px-0.5 text-success underline decoration-success/60 underline-offset-2"
        >
          {match[2]}
        </ins>,
      )
    }
    last = match.index + match[0].length
  }
  if (last < text.length) {
    parts.push(<Fragment key={key++}>{text.slice(last)}</Fragment>)
  }
  return parts
}

type Load =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; ordinance: Ordinance }

type SaveState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error'

const BackLink = (): React.JSX.Element => (
  <Link
    href="/dashboard/ordinances"
    className="text-sm font-medium text-primary hover:underline"
  >
    &larr; Back to ordinances
  </Link>
)

// The chat is where drafts are (re)written conversationally, so keep a path
// back to it — the doc page's inline editing can't restructure the draft the
// way asking the chief of staff can, and a redline draft can't be edited here
// at all.
const RefineLink = ({ slug }: { slug: string }): React.JSX.Element => (
  <Link
    href={`/dashboard/ordinances/solve/${slug}/draft`}
    className="text-sm font-medium text-primary hover:underline"
  >
    Refine with your chief of staff
  </Link>
)

// The draft document view: reads the saved draft off the ordinance record and
// lets the user edit the body/title inline with debounced autosave. A redline
// draft ({-old-}{+new+} markup) is shown read-only for review — inline editing
// of a redline is out of scope; the user refines it via the chat.
export default function OrdinanceDraftDocument({
  slug,
}: {
  slug: string
}): React.JSX.Element {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle')

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef({ title: '', body: '' })
  const saved = useRef({ title: '', body: '' })
  const saving = useRef(false)
  const pendingFlush = useRef(false)
  const mounted = useRef(true)
  // Mirrors saveState === 'error' for synchronous reads (scheduleSave and the
  // unmount flush run in the same batch as a setSaveState and would otherwise
  // see a stale closure value).
  const saveError = useRef(false)
  const titleRef = useRef<HTMLTextAreaElement>(null)

  const setSave = useCallback((next: SaveState): void => {
    saveError.current = next === 'error'
    setSaveState(next)
  }, [])

  // Redline-ness tracks the LIVE body (markup is the single source of truth),
  // so the view switches to read-only the moment {-old-}{+new+} markup appears
  // — matching what a reload would show. Memoizing on `body` still skips the
  // scan on renders where the body didn't change. `hasDraft` keys off the
  // loaded record: whether a draft exists, independent of live edits.
  const hasDraft =
    load.state === 'ready' && (load.ordinance.draftBody ?? '').length > 0
  const redline = useMemo(() => body.length > 0 && isRedline(body), [body])

  // Grow the title box to fit its content so a long ordinance title wraps
  // across lines instead of being clipped to one line.
  useLayoutEffect(() => {
    const el = titleRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [title, load.state])

  useEffect(() => {
    let cancelled = false
    fetchOrdinanceBySlug(slug)
      .then((ordinance) => {
        if (cancelled) return
        const loaded = {
          title: ordinance.draftTitle ?? '',
          body: ordinance.draftBody ?? '',
        }
        setTitle(loaded.title)
        setBody(loaded.body)
        latest.current = loaded
        saved.current = loaded
        setLoad({ state: 'ready', ordinance })
      })
      .catch(() => {
        if (!cancelled) setLoad({ state: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  // Persist the latest edit, serialized: never overlap two PATCHes (a stale
  // response could otherwise clobber newer text). Only a COMPLETE draft is
  // sent — title and body are both required, so an emptied field is held
  // locally and surfaced as "unsaved" rather than sent (which would 400) or
  // marked saved (which would lie). The outer do/while + pendingFlush catches a
  // persist() call (a keystroke's timer, or the unmount flush) that arrives
  // after the inner loop's last check but before the lock clears.
  const persist = useCallback(async (): Promise<void> => {
    if (saving.current) {
      pendingFlush.current = true
      return
    }
    saving.current = true
    try {
      do {
        pendingFlush.current = false
        while (
          latest.current.title !== '' &&
          latest.current.body !== '' &&
          (latest.current.title !== saved.current.title ||
            latest.current.body !== saved.current.body)
        ) {
          const snapshot = { ...latest.current }
          if (mounted.current) setSave('saving')
          await updateOrdinance(slug, {
            draftTitle: snapshot.title,
            draftBody: snapshot.body,
          })
          saved.current = snapshot
        }
      } while (pendingFlush.current)
      if (mounted.current) {
        const synced =
          latest.current.title === saved.current.title &&
          latest.current.body === saved.current.body
        setSave(synced ? 'saved' : 'unsaved')
      }
    } catch {
      if (mounted.current) setSave('error')
    } finally {
      saving.current = false
    }
  }, [slug, setSave])

  // Suspend autosave while a save is failing so a persistent outage isn't
  // hammered every 500ms; the Retry button is the explicit way back. Read the
  // ref, not saveState, so the first keystroke after a failure (which sets
  // 'unsaved' in the same batch) reschedules instead of being dropped.
  const scheduleSave = useCallback((): void => {
    if (saveError.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void persist(), AUTOSAVE_MS)
  }, [persist])

  // Flush a pending edit on unmount: navigating away (BackLink, a row Link)
  // within the debounce window would otherwise silently drop the last edit.
  // Route through persist() so the flush honors the in-flight lock — a direct
  // PATCH here could race an in-progress save and clobber the newer text. Skip
  // it when already in error: the user saw "Save failed" and must Retry before
  // leaving — a fire-and-forget flush here would just swallow the failure again.
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (!saveError.current) void persist()
    }
  }, [persist])

  const onTitle = (value: string): void => {
    setTitle(value)
    latest.current = { ...latest.current, title: value }
    setSave('unsaved')
    scheduleSave()
  }
  const onBody = (value: string): void => {
    setBody(value)
    latest.current = { ...latest.current, body: value }
    setSave('unsaved')
    scheduleSave()
  }

  if (load.state === 'loading') {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <p className="text-sm text-muted-foreground">Loading draft&hellip;</p>
      </div>
    )
  }

  if (load.state === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
        <BackLink />
        <p className="text-sm text-destructive">
          We couldn&apos;t load this draft. Please try again.
        </p>
      </div>
    )
  }

  const { ordinance } = load
  const sources: OrdinanceSource[] = ordinance.draftSources ?? []

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <BackLink />
        <div className="flex items-center gap-3">
          {hasDraft ? <RefineLink slug={slug} /> : null}
          {hasDraft && !redline ? (
            <span
              className="flex items-center gap-2 text-xs"
              aria-live="polite"
            >
              {saveState === 'error' ? (
                <>
                  <span className="text-destructive">Save failed</span>
                  {/* persist()'s in-flight lock coalesces rapid re-clicks, so
                      each retry is at most one PATCH. */}
                  <button
                    type="button"
                    onClick={() => void persist()}
                    className="font-medium text-primary hover:underline"
                  >
                    Retry
                  </button>
                </>
              ) : (
                <span className="text-muted-foreground">
                  {saveState === 'saving'
                    ? 'Saving…'
                    : saveState === 'saved'
                      ? 'Saved'
                      : saveState === 'unsaved'
                        ? 'Unsaved changes…'
                        : ''}
                </span>
              )}
            </span>
          ) : null}
        </div>
      </div>

      {!hasDraft ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-6">
          <p className="text-sm font-medium text-foreground">No draft yet</p>
          <p className="text-sm text-muted-foreground">
            Head back to the draft step and ask your chief of staff to write the
            first draft.
          </p>
          <Link
            href={`/dashboard/ordinances/solve/${slug}/draft`}
            className="text-sm font-medium text-primary hover:underline"
          >
            Go to the draft step
          </Link>
        </div>
      ) : redline ? (
        <article className="flex flex-col gap-4">
          <h1 className="text-2xl font-semibold leading-8 text-foreground">
            {title || 'Untitled ordinance'}
          </h1>
          <p className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-foreground">
            Redline &mdash; review only. This draft rewrites existing text in
            place; ask your chief of staff to change the language.
          </p>
          <div className="whitespace-pre-wrap break-words rounded-xl border border-border bg-card p-4 font-mono text-[13px] leading-6 text-foreground">
            {renderRedline(body)}
          </div>
        </article>
      ) : (
        <article className="flex flex-col gap-4">
          <textarea
            ref={titleRef}
            aria-label="Draft title"
            placeholder="Untitled ordinance"
            rows={1}
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            className="w-full resize-none overflow-hidden rounded-sm border-0 bg-transparent p-0 text-2xl font-semibold leading-8 text-foreground outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
          />
          <textarea
            aria-label="Draft body"
            value={body}
            onChange={(e) => onBody(e.target.value)}
            className="min-h-[60vh] w-full resize-y whitespace-pre-wrap break-words rounded-xl border border-border bg-card p-4 font-mono text-[13px] leading-6 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </article>
      )}

      {sources.length > 0 ? (
        <div className="flex flex-col gap-1.5 border-t border-border pt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Based on
          </p>
          {sources.map((source, i) => (
            <SourceLine key={`${source.id}-${i}`} source={source} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
