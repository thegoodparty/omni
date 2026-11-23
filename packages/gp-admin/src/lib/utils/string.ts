export function formatKeyAsLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim()
}

// Keeps an opaque id to one short column: the head and tail are the parts a
// reader compares, and the middle is the part that carries no information. A
// full uuid is 36 characters, so this turns each one into a single line no
// matter how narrow the column gets. Never use it as an identifier — the
// whole value still goes in the link and the title.
export function truncateMiddle(
  value: string,
  maxLength = 10,
  ellipsis = '…'
): string {
  if (value.length <= maxLength) return value
  const room = maxLength - ellipsis.length
  if (room < 2) return value.slice(0, Math.max(maxLength, 0))
  const head = Math.ceil(room / 2)
  const tail = room - head
  return `${value.slice(0, head)}${ellipsis}${value.slice(-tail)}`
}
