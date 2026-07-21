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

export const STATUS_DOT_COLORS: Record<DoorKnockStatus, string> = {
  unknown: '#9ca3af',
  not_home: '#d97706',
  supporter: '#16a34a',
  non_supporter: '#dc2626',
  inaccessible: '#7c3aed',
  refused: '#db2777',
  not_a_voter: '#475569',
}
