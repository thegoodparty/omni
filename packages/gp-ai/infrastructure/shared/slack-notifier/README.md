# Shared Slack notifier

One Lambda, `shared-slack-notifier` (us-west-2), posts every gp-ai failure
alarm to the private Slack channel `#ai-service-failures`. The failure SNS
topics subscribe to it and find it through this root's state
(`shared/slack-notifier/terraform.tfstate`): PMF Engine, autopilot agent and
bot, case scout, DDHQ matcher, serve-analyze, the alert filter's own failures,
and `gp-api-preview-shared-alarms`. The source is
`modules/serve-analyze-fargate/slack-notifier/index.ts`.

## How it posts

- Through a Slack incoming webhook. The URL is `SLACK_WEBHOOK_URL` in
  `AI_SECRETS_PROD`. There is one function, deployed with
  `environment = "prod"`, so dev topics post through the prod secret too.
- The URL is cached per warm container. After the secret changes, a warm
  container keeps the old URL until Lambda recycles it.
- An incoming webhook belongs to the Slack user who created it, and dies with
  that user's account. The first webhook did, on 2026-07-31, and every
  delivery failed silently until 2026-11. Have a Slack admin create the
  replacement, and rotate it through `docs/secrets.md`.
- `serve-analyze` task definitions also read `SLACK_WEBHOOK_URL` from
  `AI_SECRETS_<ENV>` at task start, without using it. Keep the key present in
  both bundles, or those tasks fail to start.

## Who watches the notifier

The Grafana rule `gp-ai-slack-notifier-failing`
(`packages/gp-api/deploy/components/alerts.ts`) fires when the notifier's most
recent delivery in the last 7 days failed. It reads the Lambda's `Errors`
metric through Grafana's CloudWatch data source and goes through the normal
Grafana notification policy to Delegate and `#bugs`, so it does not depend on
this Lambda or its webhook.

## Deploying

The release train applies only `environments/<env>/*` roots. Nothing in CI
builds `slack-notifier.zip` or applies this root, so a change here reaches AWS
only when someone applies it by hand.
