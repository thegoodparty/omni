# Autopilot Bot — dev environment (terraform)

Terraform for the `autopilot-bot-dev` Lambda: config, env vars, IAM, log
group, ALB wiring, and the fail-loud + no-deliveries alarms.

The canonical operational doc is `autopilot/README.md` (component map, board
contract, stage-runner env vars). This README covers only what is specific to
this terraform environment.

## Deployment

**Code** deploys with the promotion train: Terraform owns the zip
(`data.archive_file.lambda_zip` in the module), so a merge to `main` ships it
to dev via `release.yml`'s dev stage.

**Config and IAM** deploy via terraform from this directory:

```bash
cd infrastructure/environments/dev/autopilot-bot
AWS_PROFILE=work terraform init
AWS_PROFILE=work terraform plan   # read the plan before applying
AWS_PROFILE=work terraform apply
```

No hand-created `terraform.tfvars` is needed: the real board/Slack values are
committed in `terraform.auto.tfvars` (ENG-11104). See that file for what each
one wires and why it's safe to commit (non-secret ClickUp/Slack identifiers,
same convention as every other `*.auto.tfvars` in this tree).

## Board and webhook record (ENG-11104)

| Field | Value |
| --- | --- |
| ClickUp folder | "Autopilot" `901319488097` (Engineering space `90138877046`) |
| Feature list | "Autopilot features" `901329057923` |
| Story list | "Autopilot stories" `901329057924` |
| Team / workspace id | `90132012119` |
| Bot user id | `105985359` ("Collin Park" — the account `CLICKUP_API_KEY` in `AI_SECRETS_DEV` belongs to) |
| Slack channel | `#autopilot` `C0C1K9FBDG9` |

**Bot user caveat:** `AUTOPILOT_BOT_USER_ID` is the identity `router.py`'s
human-actor gate treats as the bot's own writes and therefore ignores. Because
this is also the ClickUp account behind `AUTOPILOT_CLICKUP_API_KEY`, any
manual status move made by signing in as this account (e.g. testing a gate by
hand) is invisible to the gate too — it must be a genuinely different human
account that moves a card through `approved tdd → in progress` or
`breakdown review → executing` for the gate to fire.

**Webhook** (registered 2026-09-13):

| Field | Value |
| --- | --- |
| Webhook id | `8787458c-e9af-4614-96d1-4b2308e5a370` |
| Endpoint | `https://ai-dev.goodparty.org/autopilot/webhook` |
| Events | `taskStatusUpdated`, `taskCreated`, `taskCommentPosted` |
| Scope | Folder `901319488097` ("Autopilot") |
| Health | active |

The signing secret lives in `AI_SECRETS_DEV` as `AUTOPILOT_CLICKUP_WEBHOOK_SECRET`
(module reads it via `try(local.ai_secrets["AUTOPILOT_CLICKUP_WEBHOOK_SECRET"], "")`
— never printed or committed).

**Prod is not registered yet.** No ClickUp webhook points at
`autopilot-bot-prod` — that happens after this dev thin-slice run is
validated, as a separate step. `environments/prod/autopilot-bot` still carries
placeholder (`""`) defaults for the board/Slack variables and
`no_deliveries_alarm_enabled = false` for the same reason.

## List webhooks / delete / recreate

Same shape as `clickup-bot`'s recipe (see `environments/prod/clickup-bot/README.md`),
scoped to folder `901319488097` instead of the whole workspace:

```bash
curl -s "https://api.clickup.com/api/v2/team/90132012119/webhook" \
  -H "Authorization: $CLICKUP_API_KEY" | jq
```

Recreating a webhook mints a new signing secret (`.webhook.secret`, nested)
— write it to `AUTOPILOT_CLICKUP_WEBHOOK_SECRET` in `AI_SECRETS_DEV`
immediately, or every delivery 401s until someone notices.

## Logs

```bash
AWS_PROFILE=work aws logs tail /aws/lambda/autopilot-bot-dev --follow
```
