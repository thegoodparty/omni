import type { EventRecord } from './data'
import { lineageOf } from './lineage'

export type Tone = 'good' | 'warning' | 'critical' | 'neutral'

export type Verdict = {
  tone: Tone
  label: string
  sentence: string
}

const fmt = (n: number) => n.toLocaleString('en-US')

// The dates are date-only strings, which parse as UTC midnight. Formatting them in
// the reader's zone renders the previous day everywhere west of Greenwich, so every
// "most recently" and "removed on" in the US was a day early.
const date = (iso: string) =>
  iso
    ? new Date(iso).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : 'an unknown date'

/**
 * A status enum tells you nothing if you have not read the docs. The page owes the
 * reader a sentence, and for the untrustworthy states it owes them a warning.
 */
export const verdictFor = (e: EventRecord): Verdict => {
  switch (e.status) {
    case 'active':
      return {
        tone: 'good',
        label: 'Working',
        sentence: `Fired ${fmt(e.count_30d)} times in the last 30 days, most recently ${date(e.last_seen)}.`,
      }
    case 'dormant':
      return {
        tone: 'warning',
        label: 'Silent',
        sentence:
          'The code is still there but nothing has fired for 30 days. Either nobody uses this feature or the instrument broke.',
      }
    case 'deprecating':
      return {
        tone: 'warning',
        label: 'Being removed',
        sentence: `The code was removed ${date(e.provenance.retired_date)}. Still firing inside the 30-day window, which is expected.`,
      }
    case 'orphaned_firing':
      return {
        tone: 'critical',
        label: 'Do not trust this',
        sentence: `The code was removed ${date(e.provenance.retired_date)} but events are still arriving. Something is firing that we no longer control.`,
      }
    case 'retired': {
      // `supersession` is prose ("superseded by X (why)"), not a name: 22 events carry
      // that shape, so interpolating it raw reads "replaced by superseded by X (why)".
      // lineageOf already resolves it; where it cannot, the Lineage block shows the
      // note verbatim and this sentence stays quiet rather than guessing.
      const l = lineageOf(e)
      const successor =
        l.replacedBy?.display_name ??
        l.replacedByName ??
        (l.replacedByArea ? `the ${l.replacedByArea} family` : '')
      const removed = `Removed ${date(e.provenance.retired_date)}`
      return {
        tone: 'neutral',
        label: 'Retired',
        sentence: successor
          ? `${removed} and replaced by ${successor}.`
          : l.unparsed
            ? `${removed}.`
            : `${removed} and quiet since. Nothing replaced it.`,
      }
    }
    case 'instrumented_never_observed':
      return {
        tone: 'critical',
        label: 'Never seen',
        sentence:
          'Recorded as being in the code, but Amplitude has never received it. Either the instrumentation is broken or the code axis is wrong.',
      }
    case 'code_unknown':
      return {
        tone: 'neutral',
        label: 'Unknown',
        sentence:
          'We cannot tell whether this is still in the code. Usually auto-tracked, or too new to have a provenance record.',
      }
    case 'system':
      return {
        tone: 'neutral',
        label: 'Auto-tracked',
        sentence:
          'Amplitude records this automatically. It is never health-flagged.',
      }
    default:
      return { tone: 'neutral', label: e.status, sentence: '' }
  }
}

export const TONE_CLASS: Record<Tone, string> = {
  good: 'bg-success-background text-success-dark',
  warning: 'bg-warning-background text-warning-dark',
  critical: 'bg-error-background text-error-dark',
  neutral: 'bg-muted text-muted-foreground',
}

type Coverage = { tone: Tone; label: string; blurb: string }

const UNKNOWN_COVERAGE: Coverage = {
  tone: 'critical',
  label: 'Not answerable',
  blurb:
    'At least one surface has no working event, so we cannot answer this today.',
}

export const coverageCopy = (key: string): Coverage =>
  COVERAGE_COPY[key] ?? UNKNOWN_COVERAGE

export const COVERAGE_COPY: Record<string, Coverage> = {
  covered: {
    tone: 'good',
    label: 'Answerable',
    blurb: 'Every surface this question depends on has a working event.',
  },
  partial: {
    tone: 'warning',
    label: 'Partly answerable',
    blurb:
      'Some surfaces are instrumented and some are not, so the answer is incomplete.',
  },
  uncovered: {
    tone: 'critical',
    label: 'Not answerable',
    blurb:
      'At least one surface has no working event, so we cannot answer this today.',
  },
  orphaned: {
    tone: 'critical',
    label: 'Not answerable',
    blurb:
      'Nothing here works, but events are still arriving. Any number you see is being produced by something we no longer understand.',
  },
}
