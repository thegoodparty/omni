# Autopilot Bot — prod environment (terraform)

Terraform for the `autopilot-bot-prod` Lambda: config, env vars, IAM, log
group, ALB wiring, and the fail-loud + no-deliveries alarms. The canonical
operational doc is `autopilot/README.md`; the dev twin of this file
(`../../dev/autopilot-bot/README.md`) records the dev board/webhook and the
webhook list/delete/recreate recipes this rollout reuses.

## Rollout state

The Lambda and its Terraform apply cleanly, but **nothing feeds prod yet**:
no webhook points at it, `autopilot_list_ids` is `""` (every delivery
200-skips as "list not in scope"), the no-deliveries alarm is deliberately
disabled, and the sweep workflow invokes dev only. The non-secret identity
tfvars (`terraform.auto.tfvars`: bot user id, Slack channel) are already
committed so the remaining activation is exactly the runbook below.

## Rollout runbook (ENG-11153)

Order matters — each step assumes the ones before it.

1. **Board decision (human).** Recommendation: the existing Autopilot folder
   `901319491206` (list `901329066225`) becomes the PROD board — it carries
   the real work — and dev gets a new sibling folder for pipeline testing.
   The webhook target determines which Lambda serves a board, nothing else.
   Whichever way it goes, create the list statuses BY HAND in the ClickUp UI
   (the API cannot create statuses), exact lowercase: `approved tdd`,
   `in progress`, `feedback needed`, `executing`, `qa`, `done`.
2. **Pre-registration sweep for UI automations.** The 3 "Call webhook" UI
   automations that pointed flat/unsigned payloads at prod were deleted
   2026-09-18 — verify none remain (they 401-spam the prod Lambda's logs).
   The superseded dev folder `901319488097` is deletable here too, so the
   webhook story never involves a third board.
3. **Register the prod webhook** on the prod board folder →
   `https://ai.goodparty.org/autopilot/webhook`, events `taskStatusUpdated`,
   `taskCreated`, `taskCommentPosted` (recipe in the dev README; scope to the
   folder). Capture `.webhook.secret` IMMEDIATELY into `AI_SECRETS_PROD` as
   `AUTOPILOT_CLICKUP_WEBHOOK_SECRET`.
4. **Prod secrets, one apply.** The Lambda bakes secret values into its env
   at apply time, so the secret keys and the terraform apply that bakes them
   must land together: add `AUTOPILOT_CLICKUP_API_KEY` (the current bot
   identity token, matching dev) and the webhook secret from step 3 to
   `AI_SECRETS_PROD`; verify `AMPLITUDE_MANAGEMENT_API_KEY`,
   `AUTOPILOT_MACHINE_SECRET`, and (for Slack) `AUTOPILOT_SLACK_BOT_TOKEN`
   plus `AUTOPILOT_SLACK_SIGNING_SECRET` (both from the dedicated
   "GP Autopilot" app, same values as dev) are present; then set
   `autopilot_list_ids` in `terraform.auto.tfvars` to the prod board list and
   apply this root once.
5. **Enable the no-deliveries alarm**: flip `no_deliveries_alarm_enabled`
   in `main.tf` back to true (or delete the line — the module default is
   true) in the same PR that sets `autopilot_list_ids`. Verify the ECS
   task-failure → SNS → Slack route with a forced test alert.
6. **Sweep**: add the prod invoke to `.github/workflows/autopilot-sweep.yml`
   (`autopilot-bot-prod`, second invoke or a matrix). Deliberately NOT added
   before steps 3-4: with no prod ClickUp key the handler 500s and the
   workflow's own guard fails every 15 minutes.
7. **Prod flag serving migration**: migrate gp-api prod Amplitude flag
   evaluation to the deployment-key path (prod deployment keys 13485/53792),
   mirroring the dev migration of 2026-09-19; verify the 5 legacy flags stay
   attached. Without this, a pipeline flag "on" in the prod project may not
   actually serve.
8. **Smoke**: the dev preflight recipe against prod (unsigned 401, signed
   out-of-scope ack, bot-actor gate refusal, manual sweep dispatch green),
   then one real card through epic-create on the prod conductor with a human
   approving the breakdown gate.

Expect ClickUp's webhook health counter to show stale failures from before
registration — it resets on first success (dev showed the same pattern).

## Deployment

Same as dev: code ships with the promotion train (Terraform owns the zip),
config/IAM apply from this directory (`terraform init/plan/apply` with prod
credentials). No hand-created `terraform.tfvars` is needed.

## Logs

```bash
aws logs tail /aws/lambda/autopilot-bot-prod --follow
```
