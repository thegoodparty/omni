// Which agents run on gp-api's own agents, per environment. A plain env var in
// the task definition, not a secret: `runsOnGpApi` reads it and an agent left
// out runs on the PMF Engine (packages/gp-api/src/agents/agents.registry.ts).
//
// Every environment names every agent gp-api has. A preview must, because it is the judge's candidate arm and an agent it left
// out would run the PMF Engine on both arms — comparing that engine with itself
// (docs/agent-evals.md). Dev and prod name them all because each one's judge
// read it as no worse than the PMF Engine on its migration PR, except
// `top_community_issues`, whose sweep #3880 deferred and which leans on dev
// traffic instead. An agent added here without that bar belongs in the dev list
// only until it has one.
//
// deploy/ is outside src/'s tsconfig, so this list repeats AGENTS' keys rather
// than importing them. src/agents/agentsOnGpApi.test.ts holds the two equal;
// it lives under src/ so the deploy tsconfig program never pulls src/ in.
export const PREVIEW_AGENTS_ON_GP_API = [
  'meeting_schedule',
  'opportunities_and_challenges',
  'opposition_research',
  'race_opponent_actions',
  'race_opponent_collection',
  'race_opponent_summary',
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
      'race_opponent_actions',
      'race_opponent_collection',
      'race_opponent_summary',
    ].join(',')
  return [
    'trending_issues',
    'top_community_issues',
    'meeting_schedule',
    'opportunities_and_challenges',
    'opposition_research',
    'race_opponent_actions',
    'race_opponent_collection',
    'race_opponent_summary',
  ].join(',')
}
