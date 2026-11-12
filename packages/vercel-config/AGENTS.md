# vercel-config

Pulumi (TypeScript) stack for GoodParty's Vercel settings. It owns the settings
listed below, so change them here, never in the Vercel dashboard. A dashboard
edit is not caught by the PR diff (it runs without `--refresh`) and the next
apply that touches the same resource overwrites it.

One stack, `organization/vercel-config/prod`, in `s3://goodparty-iac-state`,
encrypted with the shared `pulumi-state-config-passphrase` from SSM, the same
backend as gp-api's stacks (`packages/gp-api/deploy/AGENTS.md`).

## What it manages

| Project           | Preview protection (Vercel Authentication) | Protection exception           | Retention          | Firewall                                                                    |
| ----------------- | ------------------------------------------ | ------------------------------ | ------------------ | --------------------------------------------------------------------------- |
| `gp-ui`           | On, previews only (imported)               | `dev.goodparty.org` (imported) | 1 month (imported) | Bot protection in log mode, no OWASP (imported)                             |
| `candidate-sites` | On, previews only (created)                | `candidates-dev.goodparty.org` | 1 month (imported) | Bot protection in log mode (created; none existed)                          |
| `gp-marketing`    | Off, see below                             | None                           | 1 month (imported) | Bot protection in challenge mode and three custom rules, as live (imported) |

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

`infra-cli.ts` reads the passphrase from SSM and needs `VERCEL_API_TOKEN` set.
Before the stack exists, `diff` previews against an empty throwaway local
backend, which is exactly what the first deploy will do.

## CI

- **PR diff** (`.github/workflows/vercel-config-diff.yml`): type-checks, then
  `pulumi preview` with the preview deploy role and `VERCEL_PREVIEW_TOKEN`
  (Developer role), and comments the plan on the PR. A setting the Developer
  token cannot read fails the check with the provider's error in the comment.
- **Apply** (`.github/workflows/vercel-config.yml`): `pulumi up` on a push to
  `main` that touches this package, or a dispatch from `main`. It runs in the
  `production` environment for `VERCEL_IAC_TOKEN` and assumes
  `github-actions-vercel-config-deploy` for state. Not part of the release
  train.
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
- **The provider plugin version** comes from `@pulumiverse/vercel` in
  `package.json`; both workflows read it from there.

## Known gaps and next steps

- **Ops: the apply role.** The apply job assumes
  `github-actions-vercel-config-deploy`, added by thegoodparty/ops#528. It
  trusts only omni's `production` environment with `job_workflow_ref` pinned
  to `vercel-config.yml` on `main`, and grants Pulumi backend access for
  `vercel-config` only. ops#528 must be merged and applied before this
  package's first apply.
- **Ops: the diff role.** `github-actions-preview-deploy` needs `s3:GetObject`
  on `.pulumi/stacks/vercel-config/prod.json` once the stack exists, or every
  later PR diff fails.
- **The token.** A Vercel owner creates `VERCEL_IAC_TOKEN` and stores it as a
  `production` environment secret.
- **Not managed, on purpose:** the Protection Bypass for Automation secrets
  (an import ID is the secret), and the team webhook (its signing secret would land
  in state, which `docs/secrets.md` forbids and the PR diff role can read).
- **Not managed yet:** Observability Plus exclusions and the team spend budget.

## Next

Not in this stack yet, roughly in order:

- gp-admin-web and artifacts, the same settings as candidate-sites.
- Adopting `vercel.Project` with `protect: true` for build settings, root
  directory, Node version, skew protection and OIDC.
- `teamConfig`: team defaults, including default deployment protection for new
  projects.
- `alertRule` / `monitor` with a webhook notification to the Delegate swarm,
  once Delegate has a URL. Its signing secret would land in state, the same
  caveat as the team webhook above.
- `teamMember` / `accessGroup`, to remove standing human access.
- Deleting the stale projects gp-mono, gp-marketing-storybook and gp-webapp.

## Verify

`npm run typecheck -w packages/vercel-config`, then
`npm run infra -w packages/vercel-config -- diff` with AWS credentials and a
`VERCEL_API_TOKEN` that can read the team.
