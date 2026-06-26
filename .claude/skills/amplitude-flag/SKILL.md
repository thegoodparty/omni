---
name: amplitude-flag
description: Create an Amplitude feature flag (feature toggle) for GoodParty in both dev and prod via the Amplitude MCP. Use when the user wants to make a new feature flag, add a toggle, set up a flag to roll out a feature, or asks to turn on / enable / release a flag in prod (the skill creates the flag and explains that releasing in prod is a manual Amplitude UI step). Covers GoodParty's dev and prod Amplitude projects.
---

# Amplitude feature flags

GoodParty toggles features with Amplitude flags. This skill **creates** a feature flag in both
the dev and prod projects through the **Amplitude MCP** (the connected `mcp__Amplitude__*` tools).
It deliberately does **not** turn a flag on in prod — that's a manual UI step (see "Releasing in
prod"). Experiments, variants, and partial rollouts are out of scope; send the user to the
Amplitude UI for those.

## Precondition: the Amplitude MCP must be authenticated

Confirm the Amplitude tools are usable before doing anything. There's no separate auth-check tool —
the signal is whether the real tools exist:

- **If only `mcp__Amplitude__authenticate` is available** (no `create_flags` / `get_deployments`),
  the user isn't authenticated. Don't conclude the skill is broken — tell them to run `/mcp` and
  complete the Amplitude OAuth login, then retry. The real tools appear only after auth.
- **If the real tools are present**, proceed. The first call below (`get_deployments`) doubles as a
  live auth check; an auth error there means send them to `/mcp` and retry.

## The two projects (these are fixed)

GoodParty runs **one Amplitude project per environment**. A flag is a separate object, with its own
id, in each project. Same `key` in both.

| Env  | Project name  | `projectId` |
| ---- | ------------- | ----------- |
| dev  | GoodParty Dev | `703396`    |
| prod | GoodParty.org | `694490`    |

## Mental model: Active vs rollout (this is the confusing part)

Two independent things decide whether a flag serves a user:

- **Active** — the MCP/API field `enabled` **is** the UI's "Active/Inactive" status. `enabled: true`
  = Active (the flag is live and being evaluated). **An Inactive flag serves nothing, ever**,
  regardless of rollout or deployments. So this skill creates every flag **Active** (`enabled: true`).
- **Rollout %** — of the users the flag evaluates, the percentage who actually get the feature. This
  is the real on/off control. GoodParty does **not** do partial rollouts for feature flags: **off =
  0%, on = 100%**, nothing in between.

**The MCP can only set rollout % at creation — no MCP tool changes it afterward** (`update_flag`
exposes only `enabled`/name/description, and its schema rejects a percentage field). That's the
whole reason this skill is create-only: it creates the flag Active at the rollout you choose, and
flipping prod to 100% later happens in the Amplitude UI.

## Deployments — attach or the flag can't serve

A flag serves through **deployments** (the per-project SDK keys). A flag attached to no deployment
can't be evaluated. **Resolve deployments at runtime** with `get_deployments`, filter by
`projectId`, and **attach ALL non-deleted deployments for the project** (the safe superset — wired
wherever it's read, client or server). Don't hardcode the ids; they can change.

Current layout, for reference (verify with `get_deployments`):

| Env  | `projectId` | Deployments to attach (id — label) |
| ---- | ----------- | ---------------------------------- |
| dev  | `703396`    | `13486` — client                   |
| prod | `694490`    | `13485` — client, `53792` — server |

Note: prod has a server deployment, dev does not. If a flag is read server-side, it serves in prod
but not in dev until someone adds a server deployment to dev in the Amplitude UI. Surface this.

## Flag key naming (required convention)

Every flag `key` follows **`{product}-{feature-slug}`**:

- **`{product}`** is either **`win`** (the candidate product) or **`serve`** (the elected-official
  product). **Always ask the user which product the flag is for** — don't guess. If a flag is
  genuinely cross-product, ask the user to confirm before deviating from the convention.
- **`{feature-slug}`** is a short kebab-case description of the feature. Suggest one from the feature
  name (e.g. "New donation flow" → `new-donation-flow`), but let the user override.

So a flag for the donation flow in the Serve product gets the key `serve-new-donation-flow`. The
same `key` is used in both the dev and prod projects.

## Opinions (do not skip these)

- **Key is `{product}-{feature-slug}`.** Ask for the product (`win` or `serve`); suggest the slug.
- **Create in BOTH projects**, same `key` and same `name`, in one `create_flags` call.
- **Both flags Active** (`enabled: true`). Inactive flags never serve.
- **Attach all of each project's deployments.**
- **Prod rollout = 0%.** Prod is created Active but at 0% — live and wired, but no prod user gets it
  yet. Prod ships dark.
- **Ask the user for the dev rollout %**, and **recommend 0 (off)**. Don't assume.
- **Only ever 0 or 100** — no partial rollouts.

## Create a flag

1. **Ask which product the flag is for — `win` or `serve`** (see "Flag key naming"). Get a human
   `name` from the user, suggest a kebab-case `{feature-slug}`, and assemble the `key` as
   `{product}-{feature-slug}` (e.g. `serve-new-donation-flow`).
2. **Ask what the dev rollout should be**, recommending 0 (off). Prod is always 0 — don't ask.
3. **Resolve deployments**: call `get_deployments`, collect the non-deleted `id`s for dev (`703396`)
   and prod (`694490`).
4. One `create_flags` call, two entries (same `key`, same `name`):

```jsonc
{
  "flags": [
    {
      "projectId": "703396", // dev
      "key": "serve-new-donation-flow",
      "name": "New donation flow",
      "enabled": true, // Active
      "percentage": 0, // dev rollout — the user's choice (recommend 0)
      "deploymentIds": ["13486"], // ALL of dev's deployments
    },
    {
      "projectId": "694490", // prod
      "key": "serve-new-donation-flow",
      "name": "New donation flow",
      "enabled": true, // Active
      "percentage": 0, // prod ships dark — always 0 at create
      "deploymentIds": ["13485", "53792"], // ALL of prod's deployments
    },
  ],
}
```

5. Confirm what was created, then give the release instruction below.

## Releasing in prod (always tell the user this)

After creating, tell the user plainly: the flag exists and is Active in prod, but at **0% rollout**,
so no prod user gets it yet. **The MCP cannot change rollout, so when they're ready to release in
prod they must do it in the Amplitude UI** — open the prod flag and set its rollout to 100%. Give
them the direct link: `https://app.amplitude.com/experiment/goodparty/694490/config/<prod-flag-id>`
(the `create_flags` result includes the prod flag's id).

## Common mistakes

- **Inactive serves nothing.** That's why every flag is created Active (`enabled: true`); on/off is
  the rollout %, not the Active toggle.
- **No deployment → can't serve.** Attach all of the project's deployments at create time.
- **Trying to flip prod on through the MCP.** Not possible — rollout is create-only via the MCP.
  Direct the user to the UI.
- **Creating in only one project.** Always create both, same key.
- **Skipping the `{product}-{feature-slug}` convention.** Always ask whether the flag is for `win`
  or `serve` and prefix the key with it.
- **Hardcoding deployment ids.** Resolve them with `get_deployments` each run.
