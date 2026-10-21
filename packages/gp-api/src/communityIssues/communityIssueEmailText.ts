export const EMAIL_SHORT_TITLE_MAX = 60
export const EMAIL_TEASER_MAX = 120

// Shorten text for an email token: collapse whitespace, and when over `max`
// cut on the last word boundary that fits (leaving room for the ellipsis).
// A single word longer than `max` is hard-cut.
export const truncateOnWord = (text: string, max: number): string => {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const room = max - 1
  const slice = clean.slice(0, room + 1)
  const lastSpace = slice.lastIndexOf(' ')
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : clean.slice(0, room)
  return `${cut.replace(/[\s.,;:!?-]+$/, '')}…`
}

export const shortTitle = (title: string): string =>
  truncateOnWord(title, EMAIL_SHORT_TITLE_MAX)

export const teaser = (summary: string): string =>
  truncateOnWord(summary, EMAIL_TEASER_MAX)
