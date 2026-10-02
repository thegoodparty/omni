import { CONSTITUENT_FEEDBACK_ISSUE_LABEL_MAX_LENGTH } from '@goodparty_org/contracts'

// A tag's display name: trimmed, inner whitespace collapsed, capped at the
// label length. Theme titles come from a model and can be anything.
export const cleanTagName = (name: string): string =>
  name
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, CONSTITUENT_FEEDBACK_ISSUE_LABEL_MAX_LENGTH)

// The uniqueness key. Always derived here, never taken from a client, so
// "Flooding" and " flooding" are one tag and a proposal that matches a
// retired tag finds it instead of colliding on the index.
export const normalizeTagName = (name: string): string =>
  cleanTagName(name).toLowerCase()
