import { getUserFullName } from './getUserFullName'

// The hero headline and the page <title> are derived from the candidate's name
// rather than stored, so correcting a name in the profile reaches the live site
// immediately. Returns '' when the account carries no name — better a missing
// headline than a dangling "Vote For ".
export const getCandidateHeadline = (user?: {
  firstName: string | null
  lastName: string | null
}) => {
  const name = getUserFullName(user)
  return name ? `Vote For ${name}` : ''
}
