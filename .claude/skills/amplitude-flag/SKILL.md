---
name: amplitude-flag
description: Create or enable an Amplitude feature flag (feature toggle) for GoodParty via the Amplitude MCP. Use when the user wants to make a new feature flag, add a toggle, turn a flag on/off, enable a flag in prod, or roll out a feature behind a flag. Covers GoodParty's two Amplitude projects (dev + prod).
---

# Amplitude feature flags

GoodParty toggles features with Amplitude flags. This skill does two things through the
**Amplitude MCP** (the connected `mcp__Amplitude__*` tools): **create** a flag and **enable**
it. Anything fancier (variants, experiments, partial rollout, targeting) is out of scope —
send the user to the Amplitude UI.

The MCP must be authenticated. If the `mcp__Amplitude__*` tools aren't available, tell the
user to connect Amplitude first (it's an OAuth login), then retry.

## The two projects (these are fixed)

GoodParty runs **one Amplitude project per environment**. A flag is not one object across
both — it's a separate flag, with its own id, in each project. Same `key` in both.

| Env  | Project name  | `projectId` |
| ---- | ------------- | ----------- |
| dev  | GoodParty Dev | `703396`    |
| prod | GoodParty.org | `694490`    |

## Opinions (do not skip these)

**On create:**

- **Always create in BOTH dev and prod**, with the **same `key` and same `name`**. One
  `create_flags` call with two entries.
- **Prod always starts off.** `enabled: false` in `694490`. No exceptions — prod ships dark.
- **Always ask the user what dev should start as**, and **recommend "off"**. Don't assume.
- **Set `percentage: 100` on both** at create time, regardless of enabled state. This is the
  load-bearing trick: rollout can't be changed by the enable step (see below), so bake "serve
  to everyone" in now. Then `enabled` alone is the real on/off switch.

**On enable (the common case):**

- **99% of enable requests mean "turn it on in prod."** Default to **prod (`694490`)** unless
  the user explicitly says dev. Dev is usually already on from creation.
- Enabling is a one-field flip of `enabled: true`. It only serves users because `percentage`
  was already set to 100 at create time.
- **Never enable both envs in one action implicitly.** Prod is a deliberate, separate step.
  Confirm the env you're flipping in your reply.

## Create a flag

1. Get the `key` (e.g. `new-donation-flow`) and a human `name` from the user.
2. **Ask what dev should start as**, recommending off. Prod is always off — don't ask.
3. One `create_flags` call, two entries (same `key`, same `name`):

```jsonc
{
  "flags": [
    {
      "projectId": "703396", // dev
      "key": "new-donation-flow",
      "name": "New donation flow",
      "enabled": true, // or false, per the user's answer
      "percentage": 100,
    },
    {
      "projectId": "694490", // prod
      "key": "new-donation-flow",
      "name": "New donation flow",
      "enabled": false, // prod always starts off
      "percentage": 100,
    },
  ],
}
```

4. Confirm back: created in dev (on/off per their choice) and prod (off), same key.

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

## Common mistakes

- **Enabled but nobody sees it.** `enabled: true` with rollout at 0% serves no one (the MCP
  warns about this). That's why this skill sets `percentage: 100` at create time — so the
  later enable actually does something.
- **Using the key as `flagId`.** `update_flag` takes the per-project flag **id**. Resolve it
  via `search`/`get_flags` first.
- **Creating in only one project.** A flag that exists in dev but not prod can't be enabled in
  prod later. Always create both up front.
- **Enabling prod when asked to "enable" without an env named** is correct (it's the 99%
  case) — but say "enabled in prod" in your reply so it's never a silent surprise.
