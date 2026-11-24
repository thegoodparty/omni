// Which agents run on gp-api's own agents, per environment. A plain env var in
// the task definition, not a secret: `runsOnGpApi` reads it and an agent left
// out runs on the PMF Engine (packages/gp-api/src/agents/agents.registry.ts).
//
// prod names only an agent the Universal Judge has read as same or better
// (docs/cap-consolidation.md); dev also names the agents whose dev-versus-
// preview comparison passed, which is where they accumulate real traffic
// before prod (docs/agent-evals.md). A preview names every agent gp-api has,
// because a preview is the judge's candidate arm and an agent it left out would
// run the PMF Engine on both arms — comparing that engine with itself
// (docs/agent-evals.md).
//
// deploy/ is outside src/'s tsconfig, so this list repeats AGENTS' keys rather
// than importing them. src/agents/agentsOnGpApi.test.ts holds the two equal;
// it lives under src/ so the deploy tsconfig program never pulls src/ in.
export const PREVIEW_AGENTS_ON_GP_API = [
  'meeting_schedule',
  'opportunities_and_challenges',
  'opposition_research',
  'top_community_issues',
  'trending_issues',
]

export const agentsOnGpApi = (
  environment: 'preview' | 'dev' | 'prod',
): string => {
  if (environment === 'preview') return PREVIEW_AGENTS_ON_GP_API.join(',')
  if (environment === 'dev')
    return [
      'trending_issues',
      'top_community_issues',
      'meeting_schedule',
      'opportunities_and_challenges',
      'opposition_research',
    ].join(',')
  return 'trending_issues'
}
