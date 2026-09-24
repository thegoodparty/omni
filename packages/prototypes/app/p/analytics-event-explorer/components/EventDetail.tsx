'use client'

import { useState } from 'react'
import {
  ArrowRight,
  ChevronDown,
  ExternalLink,
  TriangleAlert,
} from 'lucide-react'
import { Badge, Button, Separator } from '@goodparty_org/styleguide'
import {
  amplitudeUrl,
  data,
  prUrl,
  type EventRecord,
  firesIn,
  FIRES_IN_LABEL,
} from '../lib/data'
import { lineageOf, PRODUCT_LABEL, productOf } from '../lib/lineage'
import { TONE_CLASS, verdictFor } from '../lib/verdict'
import { Sparkline } from './Sparkline'

const Field = ({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) => (
  <div className="min-w-0">
    <div className="text-xs uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
    <div className="text-sm break-words">
      {children || <span className="text-muted-foreground">—</span>}
    </div>
  </div>
)

/**
 * Caveats live on the behavior, not the event, so an event inherits every caveat of
 * every question it answers. This is the field that decides whether a number is
 * right or wrong, so it sits directly under the verdict and nowhere lower.
 */
const caveatsFor = (e: EventRecord) =>
  data.questions
    .filter(
      (q) =>
        q.caveats &&
        q.surfaces.some((s) => s.instrumented_by === e.display_name) &&
        // A question's caveat is usually about the question, not about every event
        // underneath it. Attaching all of them buried this card under four warnings,
        // three of which were about Pro billing and warehouse completeness. Only
        // surface one here when it actually names this event; the rest stay on the
        // question, which the card already links to.
        (q.caveats.includes(e.display_name) ||
          q.caveats.includes(e.event_type)),
    )
    .map((q) => ({ headline: q.headline, caveats: q.caveats }))

/**
 * "Which one should I use today?" is the question the status column cannot answer. A
 * removed event is only half a story: the other half is whether something replaced it,
 * and only 22 of 140 removed events record that at all. Say which case you are in
 * rather than leaving the reader to guess.
 */
const Lineage = ({ event }: { event: EventRecord }) => {
  const l = lineageOf(event)
  if (
    !l.replacedBy &&
    !l.replacedByArea &&
    !l.replacedByName &&
    !l.replaces.length &&
    !l.unparsed &&
    !l.deadEnd
  ) {
    return null
  }
  return (
    <div className="rounded-md border bg-background p-3 text-sm">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        Lineage
      </div>

      {l.replacedBy && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className="text-muted-foreground">Use instead:</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <span className="font-medium">{l.replacedBy.display_name}</span>
          <Badge className={TONE_CLASS[verdictFor(l.replacedBy).tone]}>
            {verdictFor(l.replacedBy).label}
          </Badge>
        </div>
      )}

      {l.unparsed && (
        <div className="mt-1">
          <span className="text-muted-foreground">Recorded as: </span>
          <span>{l.unparsed}</span>
        </div>
      )}

      {l.replacedByArea && (
        <div className="mt-1">
          <span className="text-muted-foreground">Replaced by the </span>
          <span className="font-medium">{l.replacedByArea}</span>
          <span className="text-muted-foreground">
            {' '}
            family, not by a single event. Filter to that area to see what is
            there now.
          </span>
        </div>
      )}

      {l.replacedByName && (
        <div className="mt-1">
          <span className="text-muted-foreground">
            Recorded as replaced by{' '}
          </span>
          <span className="font-medium">{l.replacedByName}</span>
          <span className="text-muted-foreground">
            , which is not an event we can find.
          </span>
        </div>
      )}

      {l.deadEnd && (
        <div className="mt-1 text-muted-foreground">
          Removed, and nothing is recorded as replacing it. If you need this
          measured, it needs new instrumentation.
        </div>
      )}

      {l.replaces.length > 0 && (
        <div className="mt-1">
          <span className="text-muted-foreground">Replaces: </span>
          {l.replaces.map((r) => r.display_name).join(', ')}
        </div>
      )}

      {l.reason && (
        <p className="mt-1 text-xs text-muted-foreground">{l.reason}</p>
      )}
    </div>
  )
}

export const EventDetail = ({ event }: { event: EventRecord }) => {
  const [showProvenance, setShowProvenance] = useState(false)
  const v = verdictFor(event)
  const caveats = caveatsFor(event)
  const p = event.provenance

  return (
    <div className="px-4 pb-5 pt-1 space-y-4 bg-muted/30">
      <div className="flex flex-wrap items-center gap-3">
        <Badge className={TONE_CLASS[v.tone]}>{v.label}</Badge>
        <span className="text-sm">{v.sentence}</span>
      </div>

      {caveats.map((c, i) => (
        <div
          key={i}
          className="flex gap-2 rounded-md border border-warning bg-warning-background p-3 text-sm"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning-dark" />
          <div className="min-w-0">
            <div className="font-medium">Read this before you count it</div>
            <p className="mt-1 whitespace-pre-line">
              {c.headline || c.caveats}
            </p>
            {c.headline && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  The detail, for whoever writes the query
                </summary>
                <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                  {c.caveats}
                </p>
              </details>
            )}
          </div>
        </div>
      ))}

      <Lineage event={event} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label="What it is">{event.description}</Field>
        <Field label="Where it fires">
          {firesIn(event) && (
            <span className="text-muted-foreground">
              {FIRES_IN_LABEL[firesIn(event) as 'browser' | 'server']} ·{' '}
            </span>
          )}
          {event.fires_on}
          {event.fires_on_source === 'anchor' && (
            <Badge variant="outline" className="ml-2 align-middle text-[10px]">
              drafted
              {event.anchor_confidence === 'low' &&
                `, low confidence${event.anchor_flag_reason ? `: ${event.anchor_flag_reason}` : ''}`}
            </Badge>
          )}
        </Field>
        <Field label="Weekly volume (9 weeks)">
          <div className="flex items-center gap-2">
            <Sparkline values={event.series} weeks={data.series_weeks} />
            <span className="text-xs text-muted-foreground">
              {event.count_30d.toLocaleString('en-US')} / 30d
            </span>
          </div>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Field label="Added to the code">
          {event.provenance.instrumented_date}
          {event.provenance.instrumented_pr && (
            <>
              {' '}
              <a
                className="underline"
                href={prUrl(event.provenance.instrumented_pr)}
                target="_blank"
                rel="noreferrer"
              >
                PR
              </a>
            </>
          )}
        </Field>
        <Field label="Removed from the code">
          {event.provenance.retired_date || 'still in the code'}
          {event.provenance.retired_pr && (
            <>
              {' '}
              <a
                className="underline"
                href={prUrl(event.provenance.retired_pr)}
                target="_blank"
                rel="noreferrer"
              >
                PR
              </a>
            </>
          )}
        </Field>
        <Field label="Last fired">{event.last_seen}</Field>
        <Field label="Product">{PRODUCT_LABEL[productOf(event)]}</Field>
      </div>

      {(event.questions.length > 0 || event.used_by.length > 0) && (
        <Field label="Used by">
          {event.questions.length > 0 && (
            <ul className="list-disc pl-4">
              {event.questions.map((q) => {
                const match = data.questions.find((x) => x.question === q)
                return (
                  <li key={q}>
                    {match?.answer_url ? (
                      <a
                        className="underline"
                        href={match.answer_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {q}
                      </a>
                    ) : (
                      q
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {(['column', 'report'] as const).map((kind) => {
            const items = event.used_by.filter((u) => u.kind === kind)
            if (!items.length) return null
            return (
              <div key={kind} className="mt-2">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {kind === 'column' ? 'Table columns' : 'Reports'}
                </div>
                <ul className="list-disc pl-4">
                  {items.map((u) => (
                    <li key={u.url + u.label}>
                      <a
                        className="underline"
                        href={u.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {u.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </Field>
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild size="small" variant="outline">
          <a
            href={amplitudeUrl(event.event_type)}
            target="_blank"
            rel="noreferrer"
          >
            Open in Amplitude <ExternalLink className="ml-1 h-3 w-3" />
          </a>
        </Button>
        {event.url && event.url !== 'n/a' && !event.url.startsWith('n/a') && (
          <Button asChild size="small" variant="outline">
            <a href={event.url} target="_blank" rel="noreferrer">
              {event.url} <ExternalLink className="ml-1 h-3 w-3" />
            </a>
          </Button>
        )}
        {p.instrumented_pr && (
          <Button asChild size="small" variant="outline">
            <a href={prUrl(p.instrumented_pr)} target="_blank" rel="noreferrer">
              Instrumenting PR <ExternalLink className="ml-1 h-3 w-3" />
            </a>
          </Button>
        )}
      </div>

      <Separator />

      <button
        type="button"
        onClick={() => setShowProvenance((s) => !s)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronDown
          className={`h-3 w-3 transition-transform ${showProvenance ? 'rotate-180' : ''}`}
        />
        Provenance and identifiers
      </button>

      {showProvenance && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="event_type">
            <code className="text-xs">{event.event_type}</code>
          </Field>
          <Field label="Product area">{event.area}</Field>
          <Field label="Tags">{event.tags.join(', ')}</Field>
          <Field label="OKR anchor">{event.okr}</Field>
          <Field label="Declared intent">{event.declared_intent}</Field>
          <Field label="Watchlist">{event.watchlist_status}</Field>
          <Field label="First seen">{event.first_seen}</Field>
          <Field label="All-time count">
            {event.count_total.toLocaleString('en-US')}
          </Field>
          <Field label="Instrumented">
            {p.instrumented_date}{' '}
            {p.instrumented_author_email && `by ${p.instrumented_author_email}`}
          </Field>
          <Field label="Retired">
            {p.retired_date}{' '}
            {p.retired_author_email && `by ${p.retired_author_email}`}
          </Field>
          <Field label="Supersedes to">{event.supersession}</Field>
        </div>
      )}
    </div>
  )
}
