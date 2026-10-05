// Outreach sends used to auto-create a throwaway VoterFileFilter per send,
// named with the send date so candidates could tell them apart (ENG-10521).
// The rows outlive the flow that made them, so the saved-list pickers still
// have to recognize and hide them (ENG-10514) — a candidate picking an
// audience should only see lists they built themselves.
const AUTO_VOTER_FILTER_NAME_SUFFIX = ' outreach — '

export const AUTO_VOTER_FILTER_NAME_PATTERN = new RegExp(
  `${AUTO_VOTER_FILTER_NAME_SUFFIX.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&',
  )}[A-Z][a-z]{2} \\d{1,2}, \\d{4}$`,
)
