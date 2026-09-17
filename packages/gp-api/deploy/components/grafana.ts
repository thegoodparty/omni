import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import * as grafana from '@pulumiverse/grafana'
import { Alert } from './alerting/alerts.types'
import { GLOBAL_ALERTS } from './alerts'
import {
  buildAlertDescription,
  buildAlertSummary,
  buildKnownCausesAnnotation,
  KNOWN_CAUSES_ANNOTATION,
} from './alerting/alert-notification'
import { controllerAlerts } from './alerting/controller-alerts'
import {
  EXPECTED_PROD_RECEIVERS,
  misroutedAlerts,
  PolicyTree,
} from './alerting/alert-routing'
import { personProfilesDashboardConfigJson } from './personProfilesDashboard'
import { CONTROLLER_NAMES } from '../../src/generated/route-types'

export interface GrafanaConfig {
  environment: 'dev' | 'prod'
  domain: string
}

const LOKI_DATASOURCE_UID = 'grafanacloud-logs'
const PROM_DATASOURCE_UID = 'grafanacloud-prom'

const datasourceConfig = {
  log: { uid: LOKI_DATASOURCE_UID, queryType: 'range' },
  metric: { uid: PROM_DATASOURCE_UID, queryType: 'instant' },
} as const

/**
 * Where the alert filter answers, per environment.
 *
 * PROD ONLY, and that is not an omission. One Lambda serves both environments'
 * alerts — a notification carries its own `environment` label, which the
 * handler reads — so `environments/dev/alert-filter` does not exist and there
 * is no dev endpoint to point at. A dev deploy therefore skips the contact
 * point, loudly, rather than provisioning one aimed at a host that would 404.
 *
 * The path must equal the ALB listener rule's `path_pattern` in
 * prod/shared-infra (priority 25). Two places, because Pulumi and Terraform
 * own separate state and cannot share a constant; `grafana.test.ts` reads the
 * Terraform and fails if they drift, which is the only thing making the
 * duplication safe rather than merely conventional.
 */
export const ALERT_FILTER_WEBHOOK_URLS: Record<string, string> = {
  prod: 'https://ai.goodparty.org/grafana/alert-webhook',
}

/**
 * The snapshot, read rather than imported.
 *
 * `import ... from './x.json'` needs `resolveJsonModule`, and the Pulumi
 * program has no tsconfig of its own — it compiles under ts-node's defaults, so
 * turning that on means introducing one and changing how every file in this
 * directory is compiled. Not worth it to load eight lines of JSON.
 */
const COMMITTED_POLICY = JSON.parse(
  readFileSync(join(__dirname, 'alerting/alert-routing.policy.json'), 'utf8'),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
) as PolicyTree

/**
 * Check the live notification policy tree against what the repo believes.
 *
 * The snapshot in `alerting/alert-routing.policy.json` is what the tests assert
 * against, and a snapshot is only worth having if something notices when
 * reality moves away from it. The tree is hand-editable in Grafana Cloud — it
 * is deliberately not provisioned, because the team needs to be able to change
 * routing during an incident without shipping a deploy — so drift is expected
 * to happen and just needs to be visible when it does.
 *
 * READ, NOT WRITTEN, and this function will never write. Taking ownership of
 * the tree from here would make it read-only in the UI, which trades one
 * failure mode for a worse one.
 *
 * Warns rather than fails. A deploy of unrelated application code should not be
 * blocked because somebody edited routing an hour ago, and erroring here would
 * mean exactly that. The trade-off is real and worth naming: the last warning
 * this file emitted went unnoticed for weeks. This one is backed by the test
 * suite, which fails on a PR if a newly added alert slug would be diverted
 * under the snapshot; the warning covers only the case where the live tree and
 * the snapshot disagree, which no test can see.
 */
const checkAlertRouting = async ({
  environment,
  slugs,
}: {
  environment: string
  slugs: readonly string[]
}) => {
  const auth = process.env.GRAFANA_AUTH
  const url = new pulumi.Config('grafana').get('url')
  if (!auth || !url) return

  let live: PolicyTree
  try {
    const response = await fetch(`${url}/api/v1/provisioning/policies`, {
      headers: { Authorization: `Bearer ${auth}` },
    })
    if (!response.ok) {
      pulumi.log.warn(
        `Could not read the notification policy tree (${response.status}), so ` +
          `routing was not checked this deploy.`,
      )
      return
    }
    // The provisioning API's documented response shape; `receiverFor` tolerates
    // routes it cannot interpret rather than trusting this blindly.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    live = (await response.json()) as PolicyTree
  } catch (error) {
    pulumi.log.warn(
      `Could not read the notification policy tree: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    )
    return
  }

  if (JSON.stringify(live) !== JSON.stringify(COMMITTED_POLICY)) {
    pulumi.log.warn(
      `The live notification policy tree no longer matches ` +
        `deploy/components/alerting/alert-routing.policy.json. Routing is ` +
        `hand-editable by design, so this is not necessarily wrong — but the ` +
        `snapshot is what the routing tests check, and it is now stale. ` +
        `Re-snapshot it from GET /api/v1/provisioning/policies.`,
    )
  }

  // The misrouting check is prod-only, because the tree is prod-centric: the
  // `environment != prod` route sends everything else to 'nowhere', which is
  // correct and is what keeps dev out of Slack. Checking a dev deploy against
  // EXPECTED_PROD_RECEIVERS would therefore report all seventeen slugs as
  // misrouted, and a warning that always fires is one nobody reads — the exact
  // failure this function exists to catch. Drift above is still checked
  // everywhere, since the tree is global and a dev deploy can see it move.
  if (environment !== 'prod') return

  const misrouted = misroutedAlerts({
    tree: live,
    slugs,
    environment,
    expected: EXPECTED_PROD_RECEIVERS,
  })

  for (const { slug, receiver } of misrouted) {
    pulumi.log.warn(
      `Alert '${slug}' is routed to '${receiver}', which is not a destination ` +
        `anyone reads. It will fire and notify nobody — this is what happened ` +
        `to win-peerly-warnings for months via a stale ".*warning.*" route.`,
    )
  }
}

/**
 * The webhook's shared secret, from the bundle the filter Lambda reads.
 *
 * Returns empty rather than throwing when the key is absent, so that a deploy
 * of everything else still succeeds and says what is missing. Throwing would
 * make one unset key fail the whole gp-api deploy, which is a much worse
 * outcome than alerts continuing to route the way they route today.
 */
const alertFilterWebhookSecret = async (
  environment: string,
): Promise<string> => {
  const secretId = `AI_SECRETS_${environment.toUpperCase()}`
  try {
    const version = await aws.secretsmanager.getSecretVersion({ secretId })
    // JSON.parse returns any; this bundle is a flat string map by construction,
    // and the only key read from it here is checked by the caller.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const bundle = JSON.parse(version.secretString || '{}') as Record<
      string,
      string
    >
    return bundle.WEBHOOK_SECRET || ''
  } catch (error) {
    pulumi.log.warn(
      `Could not read ${secretId} for the alert filter webhook secret: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    )
    return ''
  }
}

/**
 * A contact point that posts every notification to the gpbot alert filter
 * instead of straight to Slack.
 *
 * CREATING THIS ROUTES NOTHING. A contact point is a destination; which alerts
 * reach it is decided by the notification policy tree, and that tree is not
 * managed here — it was configured by hand in Grafana Cloud before this repo
 * provisioned any alerting, and taking it over would mean importing routing
 * whose current shape cannot be read from CI. So this resource is deliberately
 * inert until somebody repoints a route at it, which is the one step in the
 * whole feature that is a conscious human decision: it is the moment the
 * channel's contents start depending on a Lambda. See
 * gp-ai/alert_filter/README.md.
 *
 * WHAT THE POLICY TREE MUST STILL DO, and it is not optional: keep a route for
 * this contact point's OWN failures that does not pass through it. The filter
 * is a single point of failure for whatever is routed to it — a Lambda that is
 * down means notifications that go nowhere — so the alert on Grafana's own
 * delivery failures has to reach Slack by a path this function cannot break.
 * `maxAlerts` below is the other half of that: it bounds the blast radius of
 * one enormous grouped delivery rather than letting it time the webhook out.
 */
const alertFilterContactPoint = async ({
  environment,
}: {
  environment: string
}) => {
  // DERIVED, not configured. This used to read ALERT_FILTER_WEBHOOK_URL from
  // the deploy environment, which meant the resource could not be created by CI
  // at all: nothing sets that variable, so every prod deploy logged the warning
  // below and skipped, and the feature sat dark waiting on a human to export
  // something. The address is not a deployment choice — it is the ALB listener
  // rule in prod/shared-infra, at priority 25, whose path is fixed in the
  // Terraform beside it. A constant here and a path there can disagree, so the
  // path is stated once in each and the pairing is what the rollout check
  // verifies; there is no third place it can drift to.
  const url = ALERT_FILTER_WEBHOOK_URLS[environment]

  // FROM THE SAME BUNDLE THE LAMBDA READS, rather than a second copy in a
  // second place that has to be kept equal to the first. The handler compares
  // the basic-auth password against AI_SECRETS_<ENV>.WEBHOOK_SECRET, so that is
  // the value, and two bundles holding it would mean a silent auth failure the
  // day one is rotated and the other is not.
  //
  // Not generated in Terraform either, though that would need no human at all,
  // because the handler's `secret()` documents the invariant it is protecting:
  // these credentials never appear in Lambda environment variables, where
  // `get-function-configuration` shows them to anyone with Lambda read access,
  // nor in Terraform state, where they sit in plaintext in S3. A
  // `random_password` resource is exactly Terraform state.
  const secret = await alertFilterWebhookSecret(environment)
  // Skipped rather than defaulted when unconfigured. A contact point pointing
  // at the wrong URL is worse than an absent one: absent fails at provision
  // time, where somebody is watching, while wrong fails silently the first time
  // an alert has to be delivered.
  //
  // ANNOUNCED, though, because the first version of this skipped in silence and
  // the infra diff came back clean — two rule groups updated, no contact point,
  // nothing to suggest one had been expected. A deploy that quietly omits the
  // resource the rest of this feature routes through is the same shape of
  // failure the feature exists to catch, so it says so.
  if (!url || !secret) {
    pulumi.log.warn(
      `gpbot-alert-filter contact point NOT created for ${environment}: ` +
        (!url
          ? `no webhook URL is known for this environment. The filter is a ` +
            `single prod stack serving both environments' alerts, so only the ` +
            `environments in ALERT_FILTER_WEBHOOK_URLS have one.`
          : `WEBHOOK_SECRET is not set in AI_SECRETS_${environment.toUpperCase()}. ` +
            `Add it there — the same bundle and key the filter Lambda reads — ` +
            `and redeploy. See gp-ai/alert_filter/README.md.`) +
        ` Alerts keep routing wherever they route today, which is safe.`,
    )
    return undefined
  }

  return new grafana.alerting.ContactPoint('gpbot-alert-filter', {
    name: `gpbot-alert-filter-${environment}`,
    webhooks: [
      {
        url,
        httpMethod: 'POST',
        // Basic auth because it is what this integration can send without a
        // custom notifier, and the handler compares it with
        // `hmac.compare_digest`. The user is ignored; only the password is
        // checked.
        basicAuthUser: 'grafana',
        // WRAPPED, because `alerting.ContactPoint` does not declare
        // `basicAuthPassword` in its `additionalSecretOutputs` the way
        // `oncall.OutgoingWebhook` declares its `password`. Without this the
        // shared secret that guards a public endpoint sits in plaintext in
        // Pulumi state and prints unmasked in a preview. Same pattern as the
        // RDS master password in this deploy.
        basicAuthPassword: pulumi.secret(secret),
        // The filter runs a Loki query and a model call per alert, so a
        // delivery carrying hundreds would exceed the webhook's patience and
        // get retried — which is the one way a grouped delivery could turn
        // into duplicate posts. Grafana truncates past this and says so in the
        // payload, which the handler treats as an ordinary delivery.
        maxAlerts: 20,
        // Resolved notifications are suppressed here rather than filtered in
        // the handler. `payload.firings` drops them anyway, so forwarding them
        // would only spend an invocation to decide to do nothing.
        disableResolveMessage: true,
      },
    ],
  })
}

export const createGrafanaResources = async ({
  environment,
  domain,
}: GrafanaConfig) => {
  const folder = new grafana.oss.Folder('gp-api-folder', {
    title: `gp-api-${environment}`,
  })

  const labels = `service_name="gp-api", deployment_environment_name="${environment}"`

  new grafana.oss.Dashboard('service-dashboard', {
    folder: folder.uid,
    overwrite: true,
    configJson: JSON.stringify({
      title: `gp-api ${environment} - CPU & Memory`,
      uid: `gp-api-${environment}-resources`,
      editable: true,
      timezone: 'browser',
      time: { from: 'now-6h', to: 'now' },
      refresh: '1m',
      panels: [
        {
          id: 1,
          title: 'Process CPU Utilization',
          type: 'timeseries',
          gridPos: { h: 10, w: 12, x: 0, y: 0 },
          datasource: { type: 'prometheus', uid: PROM_DATASOURCE_UID },
          targets: [
            {
              expr: `avg(process_cpu_utilization{${labels}}) * 100`,
              legendFormat: 'Process CPU %',
              refId: 'A',
            },
            {
              expr: `avg(system_cpu_utilization{${labels}}) * 100`,
              legendFormat: 'System CPU %',
              refId: 'B',
            },
          ],
          fieldConfig: {
            defaults: {
              unit: 'percent',
              min: 0,
              custom: { fillOpacity: 10, lineWidth: 2 },
            },
            overrides: [],
          },
        },
        {
          id: 2,
          title: 'Process Memory Usage',
          type: 'timeseries',
          gridPos: { h: 10, w: 12, x: 12, y: 0 },
          datasource: { type: 'prometheus', uid: PROM_DATASOURCE_UID },
          targets: [
            {
              expr: `process_memory_usage{${labels}}`,
              legendFormat: 'Process Memory',
              refId: 'A',
            },
          ],
          fieldConfig: {
            defaults: {
              unit: 'bytes',
              min: 0,
              custom: { fillOpacity: 10, lineWidth: 2 },
            },
            overrides: [],
          },
        },
        {
          id: 3,
          title: 'System Memory Utilization',
          type: 'gauge',
          gridPos: { h: 8, w: 6, x: 0, y: 10 },
          datasource: { type: 'prometheus', uid: PROM_DATASOURCE_UID },
          targets: [
            {
              expr: `avg(system_memory_utilization{${labels}, system_memory_state="used"}) * 100`,
              legendFormat: 'Memory %',
              refId: 'A',
            },
          ],
          fieldConfig: {
            defaults: {
              unit: 'percent',
              min: 0,
              max: 100,
              thresholds: {
                steps: [
                  { color: 'green', value: null },
                  { color: 'yellow', value: 70 },
                  { color: 'red', value: 90 },
                ],
              },
            },
            overrides: [],
          },
        },
        {
          id: 4,
          title: 'System CPU Utilization',
          type: 'gauge',
          gridPos: { h: 8, w: 6, x: 6, y: 10 },
          datasource: { type: 'prometheus', uid: PROM_DATASOURCE_UID },
          targets: [
            {
              expr: `avg(system_cpu_utilization{${labels}}) * 100`,
              legendFormat: 'CPU %',
              refId: 'A',
            },
          ],
          fieldConfig: {
            defaults: {
              unit: 'percent',
              min: 0,
              max: 100,
              thresholds: {
                steps: [
                  { color: 'green', value: null },
                  { color: 'yellow', value: 70 },
                  { color: 'red', value: 90 },
                ],
              },
            },
            overrides: [],
          },
        },
      ],
    }),
  })

  // Public /people profiles feature dashboard (custom OTel metrics).
  new grafana.oss.Dashboard('people-profiles-dashboard', {
    folder: folder.uid,
    overwrite: true,
    configJson: personProfilesDashboardConfigJson({
      environment,
      promDatasourceUid: PROM_DATASOURCE_UID,
    }),
  })

  const alertFolder = new grafana.oss.Folder('alerts-folder', {
    title: `${environment.toUpperCase()} Alerts (provisioned via gp-api)`,
  })

  await alertFilterContactPoint({ environment })

  await checkAlertRouting({
    environment,
    slugs: [
      ...GLOBAL_ALERTS.map((alert) => alert.slug),
      ...CONTROLLER_NAMES.flatMap((controller) =>
        controllerAlerts(controller).map((alert) => alert.slug),
      ),
    ],
  })

  const alertToRule = (
    alert: Alert,
  ): grafana.types.input.alerting.RuleGroupRule => {
    const knownCauses = buildKnownCausesAnnotation(alert, environment)

    return {
      name: alert.name,
      condition: 'C',
      for: alert.for,
      isPaused: alert.disabled ?? false,
      noDataState: 'OK',
      execErrState: 'Alerting',
      annotations: {
        summary: buildAlertSummary(alert, environment),
        description: buildAlertDescription(alert, environment),
        ...(knownCauses ? { [KNOWN_CAUSES_ANNOTATION]: knownCauses } : {}),
      },
      labels: {
        environment,
        alert_slug: alert.slug,
      },
      datas: [
        {
          refId: 'A',
          queryType: datasourceConfig[alert.type].queryType,
          relativeTimeRange: { from: alert.timeRangeSeconds ?? 600, to: 0 },
          datasourceUid: datasourceConfig[alert.type].uid,
          model: JSON.stringify({
            expr: alert.expr.replace(/\$ENV/g, environment),
            refId: 'A',
          }),
        },
        {
          refId: 'B',
          queryType: '',
          relativeTimeRange: { from: 0, to: 0 },
          datasourceUid: '-100',
          model: JSON.stringify({
            type: 'reduce',
            refId: 'B',
            expression: 'A',
            reducer: 'last',
            settings: { mode: '' },
            datasource: { type: '__expr__', uid: '-100' },
          }),
        },
        {
          refId: 'C',
          queryType: '',
          relativeTimeRange: { from: 0, to: 0 },
          datasourceUid: '-100',
          model: JSON.stringify({
            type: 'threshold',
            refId: 'C',
            expression: 'B',
            conditions: [
              {
                evaluator: { type: 'gt', params: [alert.threshold] },
                operator: { type: 'and' },
                query: { params: ['B'] },
                reducer: { type: 'last', params: [] },
                type: 'query',
              },
            ],
            datasource: { type: '__expr__', uid: '-100' },
          }),
        },
      ],
    }
  }

  // Grafana evaluates a rule group as a unit, so the interval is a property of
  // the group and a rule that wants a slower cadence needs its own. Bucketing
  // by `evaluationIntervalSeconds` is what lets the two 6h-window rules opt out
  // of minute-resolution evaluation without slowing anything else down; the
  // default bucket keeps the original resource and group names so Pulumi
  // updates it in place rather than replacing every global rule.
  const globalAlertsByInterval = new Map<number, Alert[]>()
  for (const alert of GLOBAL_ALERTS) {
    const interval = alert.evaluationIntervalSeconds ?? 60
    globalAlertsByInterval.set(interval, [
      ...(globalAlertsByInterval.get(interval) ?? []),
      alert,
    ])
  }

  for (const [intervalSeconds, alerts] of globalAlertsByInterval) {
    const isDefault = intervalSeconds === 60
    new grafana.alerting.RuleGroup(
      isDefault ? 'global-rules' : `global-rules-${intervalSeconds}s`,
      {
        name: isDefault ? 'Global Rules' : `Global Rules (${intervalSeconds}s)`,
        folderUid: alertFolder.uid,
        intervalSeconds,
        rules: alerts.map(alertToRule),
      },
    )
  }

  for (const controller of CONTROLLER_NAMES) {
    const rules = controllerAlerts(controller).map(alertToRule)
    // Grafana's RuleGroup schema requires `rules` to have at least 1 item:
    // > Attribute rule requires 1 item minimum, but config has only 0 declared.
    // CONTROLLER_NAMES is auto-generated from src and can include controllers
    // with no public routes (currently `mcp`), which produce zero alerts.
    // An empty RuleGroup adds no value, so skip them rather than fail preview.
    if (rules.length === 0) continue
    new grafana.alerting.RuleGroup(`${controller}-rules`, {
      name: `${controller} routes`,
      folderUid: alertFolder.uid,
      intervalSeconds: 60,
      rules,
    })
  }

  const { probes } = await grafana.syntheticmonitoring.getProbes()

  new grafana.syntheticmonitoring.Check('health-check', {
    job: `gp-api-${environment}-health`,
    target: `https://${domain}/v1/health`,
    // Prod only. Check executions bill against one account-wide allowance
    // (100k/month) that all environments share, and three probes a minute is
    // 129,600 a month per environment — so dev alone was ~43% of our synthetic
    // monitoring volume. What it bought was nothing: probe failures raise the
    // `health-check-probe-failure` rule, and every non-prod alert is routed to
    // the `nowhere` contact point, a webhook pointed at localhost:0.
    //
    // Disabled rather than removed so the check, its history, and its Pulumi
    // state survive. If dev alerting ever gets a real destination, re-enabling
    // is this one line.
    enabled: environment === 'prod',
    frequency: 60000,
    timeout: 10000,
    probes: [
      probes['NorthCalifornia'],
      probes['NorthVirginia'],
      probes['Ohio'],
    ],
    labels: {
      environment,
      alert_slug: 'health-check',
    },
    settings: {
      http: {
        method: 'GET',
        ipVersion: 'V4',
        validStatusCodes: [200],
        failIfNotSsl: true,
      },
    },
  })
}
