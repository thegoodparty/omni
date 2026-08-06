// Ordinance amendment drafts encode edits inline in the draft body as
// {-struck old text-}{+inserted new text+} markup. This is the single shared
// parser used by the API (export, fidelity check) and the webapp (render,
// editor) so the two can never drift in how they read the same markup.

export type RedlineSegmentType = 'unchanged' | 'insertion' | 'deletion'

export interface RedlineSegment {
  type: RedlineSegmentType
  text: string
}

const MARKERS: Record<
  'deletion' | 'insertion',
  { open: string; close: string }
> = {
  deletion: { open: '{-', close: '-}' },
  insertion: { open: '{+', close: '+}' },
}

export const hasRedline = (body: string): boolean =>
  body.includes('{-') || body.includes('{+')

// Splits a draft body into ordered segments. An open marker with no matching
// close is emitted as literal text, so serializeRedline(parseRedline(x)) === x
// for any input, well-formed or not.
export const parseRedline = (body: string): RedlineSegment[] => {
  const segments: RedlineSegment[] = []
  let literal = ''
  const flushLiteral = () => {
    if (literal) {
      segments.push({ type: 'unchanged', text: literal })
      literal = ''
    }
  }
  let i = 0
  while (i < body.length) {
    const two = body.slice(i, i + 2)
    let kind: 'deletion' | 'insertion' | null = null
    if (two === MARKERS.deletion.open) kind = 'deletion'
    else if (two === MARKERS.insertion.open) kind = 'insertion'

    if (kind) {
      const close = body.indexOf(MARKERS[kind].close, i + 2)
      if (close !== -1) {
        flushLiteral()
        segments.push({ type: kind, text: body.slice(i + 2, close) })
        i = close + 2
        continue
      }
    }
    literal += body.charAt(i)
    i += 1
  }
  flushLiteral()
  return segments
}

export const serializeRedline = (segments: RedlineSegment[]): string =>
  segments
    .map((s) =>
      s.type === 'unchanged'
        ? s.text
        : `${MARKERS[s.type].open}${s.text}${MARKERS[s.type].close}`,
    )
    .join('')

// The "before" text the draft claims to be amending: keep unchanged and struck
// text, drop insertions. The fidelity check diffs this against the stored
// verbatim baseline to catch paraphrased, omitted, or invented "original" text.
export const redlineToOriginal = (body: string): string =>
  parseRedline(body)
    .filter((s) => s.type !== 'insertion')
    .map((s) => s.text)
    .join('')

// The clean amended result: keep unchanged and inserted text, drop deletions.
export const redlineToAmended = (body: string): string =>
  parseRedline(body)
    .filter((s) => s.type !== 'deletion')
    .map((s) => s.text)
    .join('')
