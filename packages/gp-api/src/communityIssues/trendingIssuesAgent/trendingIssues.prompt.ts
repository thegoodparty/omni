// An extension of
// packages/runbooks/experiments/trending_issues/instruction.md (manifest
// version 8) with the PMF Engine's runtime replaced by this agent's: input in
// the first message, getCommunityIssues for the feed, webSearch, checkLink
// and fetchPage for the web, and submitOutput in place of the file, the
// validator and the milestones. It leads that copy deliberately: the judge
// compares the two engines, and the rules here are the ones that closed the
// grounding, date and nonexistent-office gaps it found.
export const TRENDING_ISSUES_PROMPT = `# Trending Issues

List up to five issues the elected official's community is probably talking
about this week. Do not search the web or fetch pages; answer from general
knowledge of similar places. Use any plausible URL as a source. Call
submitOutput once with your answer.
`
