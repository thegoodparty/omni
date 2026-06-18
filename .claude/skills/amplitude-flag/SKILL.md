---
name: amplitude-flag
description: Create or enable an Amplitude feature flag (feature toggle) for GoodParty via the Amplitude MCP. Use when the user wants to make a new feature flag, add a toggle, turn a flag on/off, enable a flag in prod, or roll out a feature behind a flag. Covers GoodParty's two Amplitude projects (dev + prod).
---

# Amplitude feature flags

GoodParty toggles features with Amplitude flags. This skill does two things through the
**Amplitude MCP** (the connected `mcp__Amplitude__*` tools): **create** a flag and **enable**
it. Anything fancier (variants, experiments, partial rollout, targeting) is out of scope —
send the user to the Amplitude UI.

## Precondition: Amplitude MCP must be authenticated

Before anything else, confirm the Amplitude tools are usable. There's no separate auth-check
tool — the signal is whether the real tools exist:

- **If only `mcp__Amplitude__authenticate` is available** (the `create_flags` / `update_flag` /
  `get_deployments` / `search` tools are absent), the user is **not** authenticated. Don't
  conclude the skill is broken — tell them to run `/mcp` and complete the Amplitude OAuth
  login, then retry. The real tools appear only after auth.
- **If the real tools are present**, proceed. The first tool call below (`get_deployments` on
  create, `search` on enable) doubles as the live auth check; if it returns an auth error,
  send them to `/mcp` and retry.

## The two projects (these are fixed)

GoodParty runs **one Amplitude project per environment**. A flag is not one object across
both — it's a separate flag, with its own id, in each project. Same `key` in both.

| Env  | Project name  | `projectId` |
| ---- | ------------- | ----------- |
| dev  | GoodParty Dev | `703396`    |
| prod | GoodParty.org | `694490`    |

## Deployments — attach one or the flag stays dead

A flag serves through **deployments** (the per-project SDK keys). **A flag attached to no
deployment is inactive no matter what `enabled` says** — this is the single most common way
to create a flag that silently does nothing. So every flag this skill creates must be
attached to its project's deployments.

**Resolve deployments at runtime** with `get_deployments` and filter by `projectId` — don't
hardcode ids, they can change. **Attach ALL non-deleted deployments for the project** (the
safe superset: the flag is then wired wherever it's read, client or server).

Current layout, for reference (verify with `get_deployments`, don't trust this blindly):

| Env  | `projectId` | Deployments to attach (id — label) |
| ---- | ----------- | ---------------------------------- |
| dev  | `703396`    | `13486` — client                   |
| prod | `694490`    | `13485` — client, `53792` — server |

Note the asymmetry: **prod has a server deployment, dev does not.** If a flag is meant to be
read server-side (gp-api), it will serve in prod but not in dev until someone adds a server
deployment to the dev project in the Amplitude UI. Surface this to the user rather than
silently shipping a dev flag that can't serve server-side.

## Opinions (do not skip these)

**On create:**

- **Always create in BOTH dev and prod**, with the **same `key` and same `name`**. One
  `create_flags` call with two entries.
- **Always attach the project's deployments** (see above). A flag with no deployment is the
  bug this skill exists to prevent.
- **Prod always starts off.** `enabled: false` in `694490`. No exceptions — prod ships dark.
- **Always ask the user what dev should start as**, and **recommend "off"**. Don't assume.
- **Set `percentage: 100` on both** at create time, regardless of enabled state. This is the
  load-bearing trick: rollout can't be changed by the enable step (see below), so bake "serve
  to everyone" in now. Then `enabled` alone is the real on/off switch.

**On enable (the common case):**

- **99% of enable requests mean "turn it on in prod."** Default to **prod (`694490`)** unless
  the user explicitly says dev. Dev is usually already on from creation.
- Enabling is a one-field flip of `enabled: true`. It only serves users because `percentage`
  was set to 100 and a deployment was attached, both at create time.
- **Never enable both envs in one action implicitly.** Prod is a deliberate, separate step.
  Confirm the env you're flipping in your reply.

## Create a flag

1. Get the `key` (e.g. `new-donation-flow`) and a human `name` from the user.
2. **Ask what dev should start as**, recommending off. Prod is always off — don't ask.
3. **Resolve deployments**: call `get_deployments`, then collect the non-deleted `id`s for
   each project — dev (`703396`) and prod (`694490`) — into `deploymentIds`.
4. One `create_flags` call, two entries (same `key`, same `name`):

```jsonc
{
  "flags": [
    {
      "projectId": "703396", // dev
      "key": "new-donation-flow",
      "name": "New donation flow",
      "enabled": true, // or false, per the user's answer
      "percentage": 100,
      "deploymentIds": ["13486"], // ALL of dev's deployments
    },
    {
      "projectId": "694490", // prod
      "key": "new-donation-flow",
      "name": "New donation flow",
      "enabled": false, // prod always starts off
      "percentage": 100,
      "deploymentIds": ["13485", "53792"], // ALL of prod's deployments
    },
  ],
}
```

5. Confirm back: created in dev (on/off per their choice) and prod (off), same key, with
   deployments attached. Call out the dev-has-no-server-deployment gap if relevant.

## Enable a flag

1. Default the target to **prod (`694490`)**. Only use dev (`703396`) if the user said so.
2. Resolve the flag's id **in that project** — ids are per-project, and `update_flag` needs the
   id, not the key:

   ```jsonc
   // search → returns the flag id for that project
   {
     "entityTypes": ["FLAG"],
     "queries": ["new-donation-flow"],
     "appIds": [694490],
   }
   ```

   Match the result on `key`. If `search` is ambiguous, `get_flags` with the key returns every
   project's copy — pick the one whose `projectId` is `694490`.

3. Flip it:

   ```jsonc
   { "flagId": "<resolved id>", "flagConfig": { "enabled": true } }
   ```

4. Confirm back which env you enabled. To turn off, same call with `enabled: false`.

## Repair a flag that has no deployment

If a flag already exists but isn't serving (created before deployments were attached), fix it
without recreating: resolve its per-project id, then attach the project's deployments.

```jsonc
{ "flagId": "<resolved id>", "deployments": { "add": ["13485", "53792"] } }
```

## Common mistakes

- **No deployment → dead flag.** An `enabled` flag with no deployment attached serves no one
  and shows as inactive. Always attach the project's deployments at create time.
- **Enabled but nobody sees it.** `enabled: true` with rollout at 0% also serves no one (the
  MCP warns about this). That's why this skill sets `percentage: 100` at create time.
- **Using the key as `flagId`.** `update_flag` takes the per-project flag **id**. Resolve it
  via `search`/`get_flags` first.
- **Creating in only one project.** A flag that exists in dev but not prod can't be enabled in
  prod later. Always create both up front.
- **Hardcoding deployment ids.** Resolve them with `get_deployments` each run; the reference
  table above can go stale.
- **Enabling prod when asked to "enable" without an env named** is correct (it's the 99%
  case) — but say "enabled in prod" in your reply so it's never a silent surprise.
