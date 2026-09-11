// Split one assistant turn into the bubbles it should arrive as.
//
// The agent is asked to open each section of a longer answer with a short label
// on its own line (a markdown heading, or a bolded line by itself). This finds
// those boundaries and returns one chunk per section, so a week-ahead rundown
// lands as "here's your situation", then meetings, then priorities, then
// recommendations — instead of one wall a reader has to mine.
//
// Rendering-only, and Serve-only: it runs inside the prototype chrome's
// InlineSegments. Because the reveal upstream slices by character budget, a
// growing turn crosses these boundaries one at a time, which is what makes the
// chunks stream in as pieces rather than appear at once.
//
// Degrades to a single chunk when the agent writes prose with no labels, which
// is the failure mode to want: a missed split reads as today's behavior, never
// as a visible artifact.

// A line that opens a section: a markdown heading, or a line that is nothing
// but bold text (with an optional trailing colon). Deliberately NOT any line
// containing bold — the agent bolds terms mid-sentence all the time, and
// splitting on those would shatter a paragraph.
const SECTION_LEAD = /^\s*(?:#{1,6}\s+\S|\*\*[^*\n]+\*\*:?\s*$)/

const FENCE = /^\s*(?:`{3,}|~{3,})/

const BOLD_LABEL_LINE = /^\s*\*\*([^*\n]+?)\*\*:?\s*$/

// Promote a chunk's opening bold-only line to a real markdown heading.
//
// Without this the label renders inline with the body: the agent writes
// `**Meetings**\nNothing queued`, and a single newline is not a break in
// markdown, so both land in one paragraph reading "Meetings Nothing queued".
// A heading is block-level, so it gets its own line and the bubble's own h3
// styling. Handles the model choosing bold where the prompt asks for a
// heading, which it will.
export const promoteChunkLabel = (chunk: string): string => {
  const newline = chunk.indexOf('\n')
  if (newline === -1) return chunk

  const first = chunk.slice(0, newline)
  const label = BOLD_LABEL_LINE.exec(first)
  if (!label) return chunk

  return `### ${label[1]!.trim()}\n${chunk.slice(newline + 1)}`
}

export const chunkTurn = (text: string): string[] => {
  if (!text.includes('\n')) return [text]

  const chunks: string[] = []
  let current: string[] = []
  let inFence = false

  const flush = (): void => {
    const joined = current.join('\n').trim()
    if (joined) chunks.push(joined)
    current = []
  }

  for (const line of text.split('\n')) {
    if (FENCE.test(line)) inFence = !inFence

    // A boundary only counts outside a code fence, and only once there is
    // something to close off — otherwise a turn that opens with a label would
    // emit an empty first bubble.
    if (!inFence && SECTION_LEAD.test(line) && current.length > 0) {
      flush()
    }
    current.push(line)
  }
  flush()

  // An unterminated fence means the turn is mid-stream inside a code block and
  // the line-based scan cannot be trusted; render it whole and let the next
  // tick re-split.
  if (inFence) return [text]

  return chunks.length > 0 ? chunks : [text]
}
