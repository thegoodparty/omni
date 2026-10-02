// The merge tags a message can carry, and the token each fulfilment channel
// merges. The braces are the whole point: Peerly merges `{first_name}`, while
// Serve texts go out through a human with the sending tool polls use, which
// merges `{{first_name}}`. Get it wrong and the recipient is texted the token
// verbatim, so the answer lives here once rather than in each surface.
//
// Only `first_name` is listed because it is the only tag any surface emits.
// Peerly's CSV also carries last_name, city, state and zip, so adding those
// is a row here, not vendor work.
export type MergeTagChannel = 'peerly' | 'serve'

export const MERGE_TAGS = [
  {
    id: 'first_name',
    label: 'First name',
    // Shown wherever a message is previewed as the recipient reads it.
    sample: 'Sam',
    token: { peerly: '{first_name}', serve: '{{first_name}}' },
  },
] as const

export type MergeTagId = (typeof MERGE_TAGS)[number]['id']

export const mergeTagToken = (
  id: MergeTagId,
  channel: MergeTagChannel,
): string => {
  const tag = MERGE_TAGS.find((candidate) => candidate.id === id)
  if (!tag) throw new Error(`Unknown merge tag: ${id}`)
  return tag.token[channel]
}
