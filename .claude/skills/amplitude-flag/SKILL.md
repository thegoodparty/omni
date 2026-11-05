---
name: amplitude-flag
description: Create, release (ramp), or archive a GoodParty Amplitude feature flag in both dev and prod, through the amp CLI (developers) or the Amplitude Experiment Management API (Delegate and other headless agents). Use when the user wants to make a new feature flag, add a toggle, set up a flag to roll out a feature, turn a flag on or off, or release a flag in prod.
---

# Amplitude feature flags

GoodParty toggles features with Amplitude flags. This skill creates a flag in both the dev and
prod projects, flips its rollout between 0% and 100% (including releasing it in prod), and
archives it. Every step runs from the terminal. Experiments, multi-variant flags, and partial
rollouts are out of scope.

## Access: pick the path first

Two ways in, same procedure. Detect which one this session has, then use only that path's
commands. Never print a token or key, and never run `amp auth token`.

1. **amp CLI (developers).** Available when `amp auth status --json | jq .authenticated` prints
   `true`, or when `AMP_TOKEN` is set. If `amp` is missing or not logged in on a laptop, tell the
   user to run `npm install -g @amplitude/developer-cli` and then `amp auth login` once; the login
   refreshes itself after that.
2. **Experiment Management API (Delegate).** Available when `AMPLITUDE_MANAGEMENT_API_KEY` is set.
   One key covers both projects. Base URL `https://experiment.amplitude.com/api/1`, header
   `Authorization: Bearer $AMPLITUDE_MANAGEMENT_API_KEY`. Delegate can't use amp: Amplitude
   personal access tokens are capped at 30 days and are read-only.

If neither is available, stop and say which one is missing.

## The two projects and four deployments (fixed)

GoodParty runs **one Amplitude project per environment**. A flag is a separate object, with its
own numeric id, in each project. Same `key` and `name` in both.

| Env  | Project       | `projectId` | Deployments every flag gets                |
| ---- | ------------- | ----------- | ------------------------------------------ |
| dev  | GoodParty Dev | `703396`    | `239950` (gp-api), `239954` (gp-marketing) |
| prod | GoodParty.org | `694490`    | `239951` (gp-api), `239956` (gp-marketing) |

A flag with no deployment can't be evaluated, so **every new flag is attached to both of its
project's deployments at create time**. The set is fixed. Don't look it up and don't add others.

## Mental model: Active vs rollout

Two independent settings decide whether a flag serves a user:

- **Active**: the API field `enabled` is the UI's Active/Inactive status. An Inactive flag serves
  nothing, regardless of rollout or deployments. So every flag is created and kept **Active**.
- **Rollout %**: of the users the flag evaluates, the share who get the feature. This is the real
  on/off control. GoodParty uses **only 0 (off) or 100 (on)**, nothing in between.

Neither path can set Active or rollout on create: `amp flags create` ignores
`--rollout-percentage` and `--enabled` (the flag lands Inactive at 0%), and the Management API
rejects `enabled` on create. Every create is therefore **create, then update**.

## Flag key naming (required)

Every flag `key` is **`{product}-{feature-slug}`**:

- **`{product}`** is **`win`** (the candidate product) or **`serve`** (the elected-official
  product). **Always ask the user which one**; don't guess. If a flag is genuinely
  cross-product, ask the user to confirm before deviating.
- **`{feature-slug}`** is short kebab-case. Suggest one from the feature name ("New donation
  flow" → `new-donation-flow`) and let the user override.

## Opinions (do not skip these)

- **Key is `{product}-{feature-slug}`.** Ask for the product; suggest the slug.
- **Create in BOTH projects**, same `key` and `name`.
- **Both flags Active** (`enabled: true`).
- **Attach both of the project's deployments** from the table above.
- **Prod is created at 0%.** Live and wired, but no prod user gets it yet. Prod ships dark.
- **Ask the user for the dev rollout**, and **recommend 0**. Don't assume.
- **Only ever 0 or 100.**

## Find a flag's id by key

`update`, `archive`, and the deployment endpoints take the numeric flag id, not the key (amp
rejects a key with "must be the numeric flag ID"). Look it up per project:

- **amp**: `amp flags list --project <projectId> --limit 200 --json` and select
  `.data[] | select(.key == "<key>") | .id`. If `.pagination.has_more` is true and there's no match
  yet, repeat with `--cursor <.pagination.next_cursor>`.
- **REST**: `GET /flags?key=<key>&projectId=<projectId>` and take the entry in `.flags[]` whose
  `key` and `projectId` both match.

## Create a flag

1. Ask **`win` or `serve`**, get a human `name`, suggest the slug, and assemble the `key`.
2. Ask the **dev rollout** (recommend 0). Prod is always 0, so don't ask.
3. Check the key exists in neither project (see "Find a flag's id by key"). If it exists in one
   only, stop and report it rather than creating the other half blind.
4. Create in each project, then set Active and rollout on the returned id.

**amp**, once per project (dev shown; for prod use `694490`, `239951,239956`, and rollout `0`):

```bash
amp flags create --project 703396 --key serve-new-donation-flow \
  --name 'New donation flow' --description '<one line>' \
  --evaluation-mode remote --variants '[{"key":"on"}]' --rollout-weights '{"on":1}' \
  --deployment-ids 239950,239954 --json
# take .data.id from the output
amp flags update --project 703396 --flag <id> --enabled true --rollout-percentage 0 --json
```

**REST**, once per project (dev shown; for prod use `694490`, `["239951","239956"]`, and `0`):

```bash
curl -sS -X POST https://experiment.amplitude.com/api/1/flags \
  -H "Authorization: Bearer $AMPLITUDE_MANAGEMENT_API_KEY" -H 'Content-Type: application/json' \
  -d '{"projectId":"703396","key":"serve-new-donation-flow","name":"New donation flow",
       "description":"<one line>","variants":[{"key":"on"}],"rolloutWeights":{"on":1},
       "deployments":["239950","239954"],"evaluationMode":"remote"}'
# take .id from the response
curl -sS -X PATCH https://experiment.amplitude.com/api/1/flags/<id> \
  -H "Authorization: Bearer $AMPLITUDE_MANAGEMENT_API_KEY" -H 'Content-Type: application/json' \
  -d '{"enabled":true,"rolloutPercentage":0}'
```

5. Verify each flag (see "Verify"), then report both ids and the state of each.

## Release or turn off a flag (ramp)

Ramping is a rollout change on an existing flag, in one project at a time.

1. Confirm the key, which project(s), and the target: **0 or 100**, nothing else.
2. **Before any prod change, state the exact change** (project `694490`, key, current → target
   rollout) and get the user's go-ahead.
3. Find the id, then:
   - **amp**: `amp flags update --project <projectId> --flag <id> --enabled true --rollout-percentage 100 --json`
   - **REST**: `PATCH /flags/<id>` with `{"enabled":true,"rolloutPercentage":100}`
4. Verify.

To turn a feature off, ramp to 0 and leave the flag Active. Don't toggle `enabled` as the off
switch.

## Attach deployments to an existing flag

Only for a flag created before the four-deployment set, or one missing a deployment. Read its
deployments first (amp: `.data.deployments` from `amp flags get`; REST: `GET /flags/<id>`), then
add the missing ids from the table:

- **REST**: `POST /flags/<id>/deployments` with `{"deployments":["239950","239954"]}`.
- **amp** has no command for this. On the amp path, report the flag and the missing ids and hand
  the step to Delegate, which has the Management API key.

## Archive a flag

Archive in both projects once the code no longer reads the flag.

- **amp**: `amp flags archive --project <projectId> --flag <id> --yes` (it refuses without `--yes`).
- **REST**: `PATCH /flags/<id>` with `{"archive":true}`.

## Verify

Re-read each flag you touched and confirm `enabled` is true, the rollout is what you set, and both
of the project's deployments are attached:

- **amp**: `amp flags get --project <projectId> --flag <id> --json` → `.data.enabled`,
  `.data.rollout_percentage`, `.data.deployments`.
- **REST**: `GET /flags/<id>` → `enabled`, `rolloutPercentage`, `deployments`.

Report each flag with its link, `https://app.amplitude.com/experiment/goodparty/<projectId>/config/<id>`.

## Common mistakes

- **Trusting the create call's rollout.** It is ignored or rejected. Always follow a create with
  the update/PATCH that sets `enabled: true` and the rollout.
- **Inactive serves nothing.** On/off is the rollout, not the Active toggle.
- **Missing deployments.** Attach both of the project's deployments at create time.
- **Passing the key where the id goes.** Look up the numeric id per project.
- **Creating in only one project.** Always both, same key.
- **Changing prod without stating the change first.** Name the project, key, and current → target.
- **A rollout other than 0 or 100.** Not used here.
