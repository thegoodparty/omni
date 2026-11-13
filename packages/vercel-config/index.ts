import * as vercel from '@pulumiverse/vercel'

const TEAM_ID = 'team_e4HAh1NYJW4yYc38qx66yTtG'

// The Delegate swarm's team webhook, created through the API rather than here
// so its signing secret stays out of state (AGENTS.md).
const DELEGATE_SWARM_WEBHOOK_ID = 'account_hook_AsfPO8hKMo4S67hBAl8aa1ED'

// Import IDs must be known before the lookups below resolve, so the project
// IDs are spelled out for them. Inputs take the looked-up IDs.
const GP_UI_PROJECT_ID = 'prj_4Ef0XA655ylZnQNCIgs0ZARGKLyk'
const CANDIDATE_SITES_PROJECT_ID = 'prj_PFN2Upwy18Fg5jjF0BTD3vcEq5eO'
const GP_MARKETING_PROJECT_ID = 'prj_xUbQGrErwISW8pqTZtKzk9wN5gFc'

const provider = new vercel.Provider('vercel', { team: TEAM_ID })

const gpUi = vercel.getProjectOutput({ name: 'gp-ui' }, { provider })
const candidateSites = vercel.getProjectOutput(
  { name: 'candidate-sites' },
  { provider },
)
const gpMarketing = vercel.getProjectOutput(
  { name: 'gp-marketing' },
  { provider },
)

new vercel.ProjectDeploymentProtection(
  'gp-ui',
  {
    projectId: gpUi.id,
    vercelAuthentication: { deploymentType: 'preview' },
  },
  { provider, import: `${TEAM_ID}/${GP_UI_PROJECT_ID}`, protect: true },
)

new vercel.DeploymentProtectionException(
  'gp-ui-dev-goodparty-org',
  { projectId: gpUi.id, alias: 'dev.goodparty.org' },
  {
    provider,
    import: `${TEAM_ID}/${GP_UI_PROJECT_ID}/dev.goodparty.org`,
    protect: true,
  },
)

new vercel.ProjectDeploymentRetention(
  'gp-ui',
  {
    projectId: gpUi.id,
    expirationPreview: '1m',
    expirationProduction: '1m',
    expirationCanceled: '1m',
    expirationErrored: '1m',
  },
  { provider, import: `${TEAM_ID}/${GP_UI_PROJECT_ID}`, protect: true },
)

// No `owasp` block. The live config carries per-category CRS settings but no
// OWASP ruleset marker, so the ruleset is off, and declaring the block here
// would switch it on.
new vercel.FirewallConfig(
  'gp-ui',
  {
    projectId: gpUi.id,
    enabled: true,
    managedRulesets: {
      botProtection: { action: 'log', active: true },
    },
  },
  { provider, import: `${TEAM_ID}/${GP_UI_PROJECT_ID}`, protect: true },
)

// gp-webapp on dev embeds candidate sites from this alias in the website
// editor, so it stays public like dev.goodparty.org.
const candidatesDevException = new vercel.DeploymentProtectionException(
  'candidate-sites-candidates-dev-goodparty-org',
  { projectId: candidateSites.id, alias: 'candidates-dev.goodparty.org' },
  { provider, protect: true },
)

new vercel.ProjectDeploymentProtection(
  'candidate-sites',
  {
    projectId: candidateSites.id,
    vercelAuthentication: { deploymentType: 'preview' },
  },
  { provider, protect: true, dependsOn: [candidatesDevException] },
)

new vercel.ProjectDeploymentRetention(
  'candidate-sites',
  {
    projectId: candidateSites.id,
    expirationPreview: '1m',
    expirationProduction: '1m',
    expirationCanceled: '1m',
    expirationErrored: '1m',
  },
  {
    provider,
    import: `${TEAM_ID}/${CANDIDATE_SITES_PROJECT_ID}`,
    protect: true,
  },
)

new vercel.FirewallConfig(
  'candidate-sites',
  {
    projectId: candidateSites.id,
    enabled: true,
    managedRulesets: {
      botProtection: { action: 'log', active: true },
    },
  },
  { provider, protect: true },
)

new vercel.ProjectDeploymentRetention(
  'gp-marketing',
  {
    projectId: gpMarketing.id,
    expirationPreview: '1m',
    expirationProduction: '1m',
    expirationCanceled: '1m',
    expirationErrored: '1m',
  },
  {
    provider,
    import: `${TEAM_ID}/${GP_MARKETING_PROJECT_ID}`,
    protect: true,
  },
)

// Imported exactly as live, OWASP absent as on gp-ui. Rule descriptions are
// copied verbatim, including the leading space, so the import has no diff.
new vercel.FirewallConfig(
  'gp-marketing',
  {
    projectId: gpMarketing.id,
    enabled: true,
    managedRulesets: {
      botProtection: { action: 'challenge', active: true },
    },
    rules: {
      rules: [
        {
          name: 'Allow OptimizeTrack SEO crawler',
          description:
            'John Stephens (SEO consultant). OptimizeTrack crawls with several user agents (OptimizeTrack-Indexation/1.0, OptimizeTrack Ask/1.0, OptimizeTrack Content Analyzer/1.0); all skip Bot Protection.',
          active: true,
          action: { action: 'bypass' },
          conditionGroups: [
            {
              conditions: [
                { type: 'user_agent', op: 'sub', value: 'OptimizeTrack' },
              ],
            },
          ],
        },
        {
          name: 'Allow gp-api revalidation',
          description:
            " Lets gp-api's server-to-server cache bust through bot protection (ENG-11536). The endpoint checks its own secret.",
          active: true,
          action: { action: 'bypass' },
          conditionGroups: [
            {
              conditions: [
                { type: 'path', op: 'eq', value: '/api/revalidate-person' },
                { type: 'method', op: 'eq', value: 'POST' },
                { type: 'header', op: 'ex', key: 'x-revalidate-secret' },
              ],
            },
          ],
        },
        {
          name: 'Block low-value crawlers',
          description:
            'Crawlers that send no visitors: Exa, Parallel ShapBot, Meta training crawler, Petal, SE Ranking, Barkrowler. Added 2026-11-10.',
          active: true,
          action: { action: 'deny' },
          conditionGroups: [
            {
              conditions: [
                {
                  type: 'user_agent',
                  op: 're',
                  value:
                    'ExaSearchBot|ShapBot|meta-externalagent|PetalBot|SERankingBacklinksBot|Barkrowler',
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    provider,
    import: `${TEAM_ID}/${GP_MARKETING_PROJECT_ID}`,
    protect: true,
  },
)

// Vercel's default monitor only matches high severity, which every gp-ui
// anomaly in the month before this was added fell short of, and it cannot be
// changed or imported. No usage filter means all five usage metrics.
const gpUiAnomalies = new vercel.Monitor(
  'gp-ui-anomalies',
  {
    type: 'built-in',
    name: 'gp-ui usage and error anomalies',
    ruleScope: { type: 'include', projectIds: [gpUi.id] },
    triggers: [
      { type: 'usage_anomaly' },
      { type: 'error_anomaly', filter: 'statusGroup:5xx' },
    ],
    matchMinimumSeverityLevel: 'medium',
    notificationSettings: { enableTeamOwnerNotifications: false },
  },
  { provider, protect: true },
)

new vercel.MonitorWebhookNotification(
  'gp-ui-anomalies-delegate-swarm',
  { monitorId: gpUiAnomalies.id, webhookId: DELEGATE_SWARM_WEBHOOK_ID },
  { provider, protect: true },
)
