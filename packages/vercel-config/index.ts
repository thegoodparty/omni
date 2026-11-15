import { local } from '@pulumi/command'
import * as vercel from '@pulumiverse/vercel'

const TEAM_ID = 'team_e4HAh1NYJW4yYc38qx66yTtG'

// Settings the provider cannot hold safely go through the Vercel CLI
// (AGENTS.md). The CLI reads VERCEL_TOKEN from the environment infra-cli.ts
// runs Pulumi in, so the token is in no command string and not in state.
const VERCEL_CLI = 'npx -y vercel@65.16.0'

// The Delegate swarm's team webhook, created through the API rather than here
// so its signing secret stays out of state (AGENTS.md).
const DELEGATE_SWARM_WEBHOOK_ID = 'account_hook_AsfPO8hKMo4S67hBAl8aa1ED'

// Import IDs must be known before the lookups below resolve, so the project
// IDs are spelled out for them. Inputs take the looked-up IDs.
const GP_UI_PROJECT_ID = 'prj_4Ef0XA655ylZnQNCIgs0ZARGKLyk'
const CANDIDATE_SITES_PROJECT_ID = 'prj_PFN2Upwy18Fg5jjF0BTD3vcEq5eO'
const GP_MARKETING_PROJECT_ID = 'prj_xUbQGrErwISW8pqTZtKzk9wN5gFc'
const GP_ADMIN_WEB_PROJECT_ID = 'prj_ZT7POAebSPy3jFf2u0xKIUZTQpcT'
const ARTIFACTS_PROJECT_ID = 'prj_mZyNcY3dqoIihryPvjp9rCdrf2TY'

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
const gpAdminWeb = vercel.getProjectOutput(
  { name: 'gp-admin-web' },
  { provider },
)
const artifacts = vercel.getProjectOutput({ name: 'artifacts' }, { provider })

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

// Created rather than imported: no method was on, and an import must match
// live. Production stays public behind gp-admin's own Clerk sign-in.
new vercel.ProjectDeploymentProtection(
  'gp-admin-web',
  {
    projectId: gpAdminWeb.id,
    vercelAuthentication: { deploymentType: 'preview' },
  },
  { provider, protect: true },
)

new vercel.ProjectDeploymentRetention(
  'gp-admin-web',
  {
    projectId: gpAdminWeb.id,
    expirationPreview: '1m',
    expirationProduction: '1m',
    expirationCanceled: '1m',
    expirationErrored: '1m',
  },
  { provider, import: `${TEAM_ID}/${GP_ADMIN_WEB_PROJECT_ID}`, protect: true },
)

// Every deployment, the custom domains included: artifact pages are private.
new vercel.ProjectDeploymentProtection(
  'artifacts',
  {
    projectId: artifacts.id,
    vercelAuthentication: { deploymentType: 'all' },
  },
  { provider, import: `${TEAM_ID}/${ARTIFACTS_PROJECT_ID}`, protect: true },
)

new vercel.ProjectDeploymentRetention(
  'artifacts',
  {
    projectId: artifacts.id,
    expirationPreview: '1m',
    expirationProduction: '1m',
    expirationCanceled: '1m',
    expirationErrored: '1m',
  },
  { provider, import: `${TEAM_ID}/${ARTIFACTS_PROJECT_ID}`, protect: true },
)

// Standard Protection, as the team has it today. A command runs only on
// `up`: on create, and as its `update` when the command or stdin changes.
// No `triggers`: a trigger change replaces the command, which `protect`
// blocks. `--silent` keeps the response, which carries the team invite code,
// out of the stdout recorded in state.
const teamDefaultCommand = `${VERCEL_CLI} api /v2/teams/${TEAM_ID} -X PATCH --input - --scope good-party --silent`
const teamDefaultDeploymentProtection = new local.Command(
  'team-default-deployment-protection',
  {
    create: teamDefaultCommand,
    update: teamDefaultCommand,
    stdin: JSON.stringify({
      defaultDeploymentProtection: {
        ssoProtection: { deploymentType: 'all_except_custom_domains' },
      },
    }),
  },
  { protect: true },
)

const observabilityPlusProjects = [
  { name: 'gp-ui', enabled: true },
  { name: 'candidate-sites', enabled: true },
  { name: 'gp-marketing', enabled: false },
  { name: 'gp-admin-web', enabled: true },
  { name: 'artifacts', enabled: true },
]
for (const { name, enabled } of observabilityPlusProjects) {
  const cli = `${VERCEL_CLI} project observability ${enabled ? 'enable' : 'disable'} ${name} --yes --scope good-party --json`
  // Enabling an already enabled project exits 1 with this API error, so it
  // counts as success. Disabling an already disabled project exits 0.
  const command = enabled
    ? `if out=$(${cli} 2>&1); then printf '%s\\n' "$out"; else printf '%s\\n' "$out" >&2; printf '%s' "$out" | grep -q 'Project does not belong to the disabled projects'; fi`
    : cli
  // After the team default, so its `npx` fills the package cache first and
  // these five do not race to install the CLI into it.
  new local.Command(
    `${name}-observability-plus`,
    { create: command, update: command },
    { protect: true, dependsOn: [teamDefaultDeploymentProtection] },
  )
}

// Vercel's default monitor only matches high severity, which every gp-ui
// anomaly in the month before this was added fell short of, and it cannot be
// changed or imported. No usage filter means all five usage metrics.
// The aliases keep the URNs from before candidate-sites joined, so the rename
// updates the live monitor and its webhook link instead of replacing them.
const projectAnomalies = new vercel.Monitor(
  'project-anomalies',
  {
    type: 'built-in',
    name: 'gp-ui and candidate-sites usage and error anomalies',
    ruleScope: {
      type: 'include',
      projectIds: [gpUi.id, candidateSites.id],
    },
    triggers: [
      { type: 'usage_anomaly' },
      { type: 'error_anomaly', filter: 'statusGroup:5xx' },
    ],
    matchMinimumSeverityLevel: 'medium',
    notificationSettings: { enableTeamOwnerNotifications: false },
  },
  { provider, protect: true, aliases: [{ name: 'gp-ui-anomalies' }] },
)

new vercel.MonitorWebhookNotification(
  'project-anomalies-delegate-swarm',
  { monitorId: projectAnomalies.id, webhookId: DELEGATE_SWARM_WEBHOOK_ID },
  {
    provider,
    protect: true,
    aliases: [{ name: 'gp-ui-anomalies-delegate-swarm' }],
  },
)
