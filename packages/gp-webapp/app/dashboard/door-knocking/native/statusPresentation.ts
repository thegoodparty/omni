import { DoorKnockStatus } from '@goodparty_org/contracts'

// 'unknown' is not "never knocked" — it also covers answered-but-unsure
// (deriveKnockStatus), so the label matches the filter vocabulary.
export const STATUS_LABELS: Record<DoorKnockStatus, string> = {
  unknown: 'Support unknown',
  not_home: 'Not home',
  supporter: 'Supporter',
  non_supporter: 'Non-supporter',
  inaccessible: 'Inaccessible',
  refused: 'Refused',
  not_a_voter: 'Not a voter',
}

// THE status palette — the map dots (deck.gl RGBA) and every legend chip
// (CSS hex) derive from these same numbers, so they cannot drift apart.
// The vocabulary is the demo's: unknown grey, not home yellow, supporter
// green, non-supporter red, inaccessible dark grey, refused black.
// not_a_voter (ours, not in the demo legend) is warm stone.
export const STATUS_RGB: Record<DoorKnockStatus, [number, number, number]> = {
  unknown: [156, 163, 175],
  not_home: [234, 179, 8],
  supporter: [22, 163, 74],
  non_supporter: [220, 38, 38],
  inaccessible: [71, 85, 105],
  refused: [10, 10, 10],
  not_a_voter: [120, 113, 108],
}

const toHex = ([r, g, b]: [number, number, number]): string =>
  `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`

export const STATUS_DOT_COLORS: Record<DoorKnockStatus, string> =
  Object.fromEntries(
    Object.entries(STATUS_RGB).map(([status, rgb]) => [
      status,
      toHex(rgb as [number, number, number]),
    ]),
  ) as Record<DoorKnockStatus, string>
