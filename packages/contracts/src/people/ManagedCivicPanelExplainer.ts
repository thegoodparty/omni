// The Chief of Staff's explanation of the civic panel GoodParty builds,
// after the official presses Build my civic panel, and its answer to How
// does it work?. Approved, fixed words: gp-api's explain tool returns
// them and the agent writes them as they are. They say how the civic panel
// works on purpose, the one exception to docs/product-copy.md rule 3.

// What the official sends when they ask how it works. Visible: they picked
// it, as an answer.
export const MANAGED_CIVIC_PANEL_HOW_IT_WORKS = 'How does it work?'

// "1 in 5" from a share of residents, or null where the share is too small
// or too large to say as a friendly 1 in N (N from 2 to 10).
export const managedCivicPanelOneInN = (share: number): string | null => {
  if (!Number.isFinite(share) || share <= 0) return null
  const n = Math.round(1 / share)
  return n >= 2 && n <= 10 ? `1 in ${n}` : null
}

export const managedCivicPanelExplanation = (place: string | null): string =>
  [
    `Your civic panel is a group of ${place ? `${place} residents` : 'residents'}, from every age group, neighborhood, gender and race, who've said yes to hearing from your office. You can turn to them whenever you want to hear from the whole city, not just the people at the podium: before a big vote, while you're shaping a policy, or when you want to understand an issue more deeply.`,
    "Your part is approving one invite. We gather the residents for you, in your name. It's free in early access.",
  ].join('\n\n')

export const managedCivicPanelHowItWorks = ({
  place,
  goalMembers,
  olderShare,
}: {
  place: string | null
  goalMembers: number
  // The share of the district's adults who are 65 or older, from the
  // census. Null where it could not be read.
  olderShare: number | null
}): string => {
  const where = place ?? 'your district'
  const oneInN =
    olderShare === null ? null : managedCivicPanelOneInN(olderShare)
  const example = oneInN
    ? `If about ${oneInN} residents is 65 or older, about ${oneInN} seats goes to people 65 and older.`
    : `Every age group gets seats in line with its share of ${where}.`
  return [
    `We invite residents from every part of ${where} by text, in your name. Anyone who replies JOIN takes a seat.`,
    `Your civic panel has ${goalMembers} seats, split to match ${where}. ${example} The same goes for neighborhoods, gender and race. We keep inviting until every group has its fair share.`,
    `When you ask a question, we wait until every group has answered before showing results, so a few loud voices can't tip it. Then we balance the answers so they reflect all of ${where}, not just whoever replied most. That's how a few hundred people can speak for the whole city.`,
    'Members hear from your office about once a month, and anyone can text STOP to leave.',
  ].join('\n\n')
}
