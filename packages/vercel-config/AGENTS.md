# vercel-config

Pulumi (TypeScript) stack for GoodParty's Vercel settings. It owns the settings
listed below, so change them here, never in the Vercel dashboard. A dashboard
edit is not caught by the PR diff (it runs without `--refresh`) and the next
apply that touches the same resource overwrites it.

One stack, `organization/vercel-config/prod`, in `s3://goodparty-iac-state`,
encrypted with the shared `pulumi-state-config-passphrase` from SSM, the same
backend as gp-api's stacks (`packages/gp-api/deploy/AGENTS.md`).

## What it manages

| Project           | Vercel Authentication                  | Protection exception           | Retention          | Firewall                                                                    | Observability Plus |
| ----------------- | -------------------------------------- | ------------------------------ | ------------------ | --------------------------------------------------------------------------- | ------------------ |
| `gp-ui`           | On, previews only (imported)           | `dev.goodparty.org` (imported) | 1 month (imported) | Bot protection in log mode, no OWASP (imported)                             | Included           |
| `candidate-sites` | On, previews only (created)            | `candidates-dev.goodparty.org` | 1 month (imported) | Bot protection in log mode (created; none existed)                          | Included           |
| `gp-marketing`    | Off, see below                         | None                           | 1 month (imported) | Bot protection in challenge mode and three custom rules, as live (imported) | Excluded           |
| `gp-admin-web`    | On, previews only (created), see below | None                           | 1 month (imported) | None, not created                                                           | Included           |
| `artifacts`       | On, all deployments (imported)         | None                           | 1 month (imported) | None, not created                                                           | Included           |

Team-level settings:

| Setting                                | What                                                                                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project-anomalies` (`vercel.Monitor`) | Built-in monitor on gp-ui and candidate-sites: usage anomaly on all five metrics (CDN requests, Fast Data Transfer, function invocations, duration and CPU) and 5xx error anomaly, medium severity and up (created) |
| `project-anomalies-delegate-swarm`     | Links that monitor to the Delegate swarm's team webhook, which files a Bugs ticket per alert (created)                                                                                                              |
| `team-default-deployment-protection`   | Vercel Authentication copied to new projects: `all_except_custom_domains`, Standard Protection, as live (set through the CLI, see below)                                                                            |

The projects are `getProject` lookups. Never add a `vercel.Project` resource:
it would own every project setting, including build and env vars. Every
resource carries `protect: true`, and anything that existed was adopted with
`import`. Deleting a protection or exception resource turns that protection
off or on, so a removal from `index.ts` fails until the `protect` is dropped
first.

### Why gp-marketing previews are not protected

gp-marketing deploys from the separate thegoodparty/gp-marketing repo, and its
dev environment is the `develop` branch's preview. Vercel Authentication on
its previews would break:

- gp-api dev's cache busting: `MARKETING_REVALIDATE_URL` in
  `packages/gp-api/deploy/index.ts` posts to
  `https://gp-marketing-git-develop-good-party.vercel.app/api/revalidate-person`,
  and a protected preview answers that server-to-server call with a 401. The
  firewall's "Allow gp-api revalidation" rule bypasses bot protection, not
  deployment protection.
- gp-marketing's `test:e2e:revalidate` Playwright spec, run by hand against
  that same develop URL (`E2E_BASE_URL`).
- Marketing staff reviewing PR previews, who likely have no Vercel seat.

A branch-alias exception is not the fix, since it would leave the PR previews
open anyway. Protecting it means moving gp-api dev to a stable custom domain
first.

### gp-admin-web: previews behind Vercel Authentication, production public

Production (`admin.goodparty.org`) stays public: gp-admin's own Clerk
Organization sign-in gates it. Previews need a Vercel login on top, because
every gp-admin preview's OIDC token is an M2M admin caller on dev gp-api
(`VERCEL_OIDC_ADMIN_PROJECTS`). Nothing fetches a gp-admin preview: no
workflow runs gp-admin's Playwright suite against one, gp-api only links to
`admin.goodparty.org`, and gp-admin has no API routes or webhooks. If a
workflow ever needs to, it needs a Protection Bypass for Automation secret,
as gp-webapp's E2E has. Staff without a Vercel seat cannot open previews.

### Settings set through the Vercel CLI

Two settings are `@pulumi/command` `local.Command`s that run the Vercel CLI,
pinned as `VERCEL_CLI` in `index.ts`:

- **Team default deployment protection.** `vercel api /v2/teams/<teamId> -X
PATCH` with the `defaultDeploymentProtection` body on stdin. `vercel.TeamConfig`
  would cover it, but its read stores the whole team, including the team
  invite code, which the Owner apply token can see. That puts a join
  credential in state, which `docs/secrets.md` forbids. `--silent` keeps the
  PATCH response, which also carries the invite code, out of the recorded
  stdout. `ssoProtection: null` turns it off for new projects.
- **Observability Plus per project.** `vercel project observability
enable|disable <project> --yes --scope good-party --json`. The provider has
  no resource for it.

How they behave:

- They run only on `up`: on create, and as their `update` when the command
  string or stdin changes. `pulumi preview` (the PR diff) and `pulumi refresh`
  never run them; a refresh does not read Vercel for them either.
- The desired value lives in the command string or stdin, never in
  `triggers`: a trigger change replaces the command, which `protect` blocks.
- Every command must be safe to rerun. Both CLI calls are a plain `PUT` or
  `PATCH` of the desired value, so the first `up` rewrites what is already
  live.
- The CLI reads `VERCEL_TOKEN`, which `infra-cli.ts` sets from
  `VERCEL_API_TOKEN` in the environment Pulumi runs in. Never pass it through
  a command's `environment` input: inputs are stored in state.
- A dashboard change is not seen, and is not undone until the command next
  changes. Removing a command from `index.ts` leaves the setting as it is.
- The observability commands depend on the team default one, so its `npx`
  fills the package cache before the other five run.

### Anomaly alerts

Alerts need Observability Plus, which covers every project except
gp-marketing (above). The monitor is scoped to gp-ui and candidate-sites.

Vercel's own default monitor, `ar_default`, covers every project at high
severity and up and emails team owners. It is left alone: the API lets only
its notification settings change, and the provider refuses to import it.
The new monitor exists because gp-ui's usage anomalies so far were all medium,
which `ar_default` never matches.

A team webhook gets alert events only from the monitors linked to it
([Vercel docs](https://vercel.com/docs/alerts/configure-alerts#configure-webhooks)),
so `MonitorWebhookNotification` is what routes them. Linking it also limits
that webhook to the linked monitors' alerts. Owner emails stay off on the new
monitor; the swarm's ticket is the notification.

### The Delegate swarm webhook is created out of band

The team webhook `account_hook_AsfPO8hKMo4S67hBAl8aa1ED` was created through
the Vercel API on purpose, and this stack references it by ID only. A
`vercel.Webhook` resource would put its signing secret in state, which
`docs/secrets.md` forbids and the PR diff role can read. Do not import it.
It points at the Delegate swarm and subscribes to `budget.reached`,
`alerts.triggered` and `firewall.attack`. To change it, use the API or
dashboard and keep the ID; a new webhook means a new ID here.

### candidates-dev.goodparty.org is stale

The alias points at a `develop` preview from 2026-07-31. The release train
deploys candidate-sites to dev without re-aliasing it, so the dev website
editor embeds July code. A follow-up, not this stack's job.

## Files

| Path           | Purpose                                                                |
| -------------- | ---------------------------------------------------------------------- |
| `index.ts`     | The program                                                            |
| `infra-cli.ts` | `npm run infra -w packages/vercel-config -- <diff [--json] \| deploy>` |
| `Pulumi.yaml`  | Project metadata (`name: vercel-config`)                               |

`infra-cli.ts` reads the passphrase from SSM, needs `VERCEL_API_TOKEN` set,
and passes it to the Vercel CLI as `VERCEL_TOKEN`.
Before the stack exists, `diff` previews against an empty throwaway local
backend, which is exactly what the first deploy will do.

## CI

- **PR diff** (`.github/workflows/vercel-config-diff.yml`): type-checks, then
  `pulumi preview` with the shared pull-request role
  (`github-actions-preview-deploy`) and `VERCEL_PREVIEW_TOKEN`
  (Developer role), and comments the plan on the PR. A setting the Developer
  token cannot read fails the check with the provider's error in the comment.
- **Apply** (`.github/workflows/vercel-config.yml`): `pulumi up` on a push to
  `main` that touches this package, or a dispatch from `main`. It runs in the
  `production` environment for `VERCEL_TOKEN`, the release train's production
  deploy token, and assumes the shared deploy role (`vars.AWS_ROLE_ARN`) for
  state. Not part of the release train.
- **The apply relies on `VERCEL_TOKEN`'s team role.** Changing Vercel
  Authentication, protection exceptions, retention and the firewall config
  takes Member (or Owner) on the team, or Project Administrator on each
  project. Developer is not enough. If the token's role is lowered, the
  apply fails.
- Plugins are installed with the job's `GITHUB_TOKEN` and cached, because the
  automatic download during `preview` is unauthenticated and hits GitHub's rate
  limit on shared runners.

## Gotchas

- **OWASP is off, and declaring it turns it on.** gp-ui's and gp-marketing's
  live firewall configs carry per-category CRS settings but no OWASP ruleset
  marker. The provider
  sends the marker whenever an `owasp` block is present, so leave it out. Any
  managed-ruleset change is a full `PUT` of the config.
- **Retention's "keep 10 deployments" is not modelled** by the provider; it is
  left as set in Vercel.
- **Renaming a resource replaces it** unless the old name stays in its
  `aliases`. The anomaly monitor and its webhook link carry their `gp-ui-*`
  names that way.
- **The plugin versions** come from `@pulumiverse/vercel` and
  `@pulumi/command` in `package.json`; both workflows read them from there.
  `@pulumi/command` stays below 1.3.0, which would lift the repo's shared
  `@pulumi/pulumi`.

## Known gaps and next steps

- **Ops: the apply role.** The apply job assumes the shared deploy role,
  `github-actions-pulumi-deploy`. Because the job runs in the `production`
  environment, that role must trust
  `repo:thegoodparty/omni:environment:production`, which thegoodparty/ops#528
  adds. ops#528 must be merged and applied before this package's first apply.
- **Ops: the diff role.** The diff assumes the shared pull-request role,
  `github-actions-preview-deploy`. It needs `s3:GetObject` on
  `.pulumi/stacks/vercel-config/prod.json` once the stack exists, or every
  later PR diff fails. ops#528 grants that too.
- **Not managed, on purpose:** the Protection Bypass for Automation secrets
  (an import ID is the secret), the team webhook (see above), the default
  monitor `ar_default`, the team spend budget, and every other
  `vercel.TeamConfig` field (see "Settings set through the Vercel CLI").
  The budget is set in the Vercel dashboard, and the team webhook already
  subscribes to `budget.reached`.
- **Not managed yet:** project build settings, env vars, domains and OIDC
  (no `vercel.Project`).

## Next

Not in this stack yet, roughly in order:

- Adopting `vercel.Project` with `protect: true` for build settings, root
  directory, Node version, skew protection and OIDC.
- Anomaly monitors for gp-admin-web and artifacts, which Observability Plus
  already covers, and for gp-marketing if it is included.
- `teamMember` / `accessGroup`, to remove standing human access.
- Deleting the stale projects gp-mono, gp-marketing-storybook and gp-webapp.

## Verify

`npm run typecheck -w packages/vercel-config`, then
`npm run infra -w packages/vercel-config -- diff` with AWS credentials and a
`VERCEL_API_TOKEN` that can read the team.
