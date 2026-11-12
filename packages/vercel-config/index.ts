import * as vercel from '@pulumiverse/vercel'

const TEAM_ID = 'team_e4HAh1NYJW4yYc38qx66yTtG'

// Import IDs must be known before the lookup below resolves, so the project ID
// is spelled out for them. Inputs take the looked-up ID.
const GP_UI_PROJECT_ID = 'prj_4Ef0XA655ylZnQNCIgs0ZARGKLyk'

const provider = new vercel.Provider('vercel', { team: TEAM_ID })

const gpUi = vercel.getProjectOutput({ name: 'gp-ui' }, { provider })

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
