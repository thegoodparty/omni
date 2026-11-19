// Which agents run on gp-api's own agents, per environment. A plain env var in
// the task definition, not a secret: `runsOnGpApi` reads it and an agent left
// out runs on the PMF Engine (packages/gp-api/src/agents/agents.registry.ts).
//
// dev and prod name only an agent the Universal Judge has read as same or
// better (docs/cap-consolidation.md). A preview names every agent gp-api has,
// because a preview is the judge's candidate arm and an agent it left out would
// run the PMF Engine on both arms — comparing that engine with itself
// (docs/judge-eval-framework-plan.md).
//
// deploy/ is outside src/'s tsconfig, so this list repeats AGENTS' keys rather
// than importing them. src/agents/agentsOnGpApi.test.ts holds the two equal;
// it lives under src/ so the deploy tsconfig program never pulls src/ in.
export const PREVIEW_AGENTS_ON_GP_API = [
  'top_community_issues',
  'trending_issues',
]

export const agentsOnGpApi = (
  environment: 'preview' | 'dev' | 'prod',
): string =>
  environment === 'preview'
    ? PREVIEW_AGENTS_ON_GP_API.join(',')
    : 'trending_issues'
