import type { Prisma } from '@/generated/prisma'

// A priority's round 2 text: how its send is marked and its two draws
// joined. When it is drawn is the Serve SMS schedule rule's
// (roundTwoDrawCutoff). See docs/features/civic-panel-rounds.md.

// How a round 2 send is marked: its list carries a sample size and nothing
// drawn yet. Nothing else saves a list that way, since every other sample is
// drawn when it is saved, and such a list resolves to nobody, so a send that
// reached delivery early would text no one.
export const UNDRAWN_SAMPLE_WHERE = {
  sampleSize: { not: null },
  sampledAt: null,
} satisfies Prisma.VoterFileFilterWhereInput

export const isUndrawnSample = (
  list: { sampleSize: number | null; sampledAt: Date | null } | null,
): boolean => list?.sampleSize != null && !list.sampledAt

// The steered draw and the unsteered one, as one list of at most `size`.
// The unsteered draw already leaves out who the steered one took; this
// holds the list to the paid size even if a draw ran over.
export const unionDraws = (
  steered: string[],
  unsteered: string[],
  size: number,
): string[] => [...new Set([...steered, ...unsteered])].slice(0, size)
