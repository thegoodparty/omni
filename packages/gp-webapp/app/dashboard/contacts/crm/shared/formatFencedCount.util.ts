// A fenced count (ENG-10775) is a FENCE_LIMIT-capped lower bound, not the
// list's true membership — people-api hit its query statement-timeout guard
// and floored the number instead of finishing the exact count. Render it
// with a trailing "+" so it never reads as an exact figure. Shared by
// ListCard and ListDetailSheet so the same "People" count can't drift.
export const formatFencedCount = (count: number, fenced: boolean | undefined) =>
  `${count.toLocaleString()}${fenced ? '+' : ''}`
