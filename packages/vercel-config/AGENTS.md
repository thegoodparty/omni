# vercel-config

Pulumi (TypeScript) stack for GoodParty's Vercel settings. It owns the settings
listed below, so change them here, never in the Vercel dashboard. A dashboard
edit is not caught by the PR diff (it runs without `--refresh`) and the next
apply that touches the same resource overwrites it.

One stack, `organization/vercel-config/prod`, in `s3://goodparty-iac-state`,
encrypted with the shared `pulumi-state-config-passphrase` from SSM, the same
backend as gp-api's stacks (`packages/gp-api/deploy/AGENTS.md`).

## What it manages (gp-ui only)

| Resource                        | Setting                                                           | How it got here |
| ------------------------------- | ----------------------------------------------------------------- | --------------- |
| `ProjectDeploymentProtection`   | Vercel Authentication on preview deployments only                 | Imported        |
| `DeploymentProtectionException` | `dev.goodparty.org` stays public while previews are protected     | Imported        |
| `ProjectDeploymentRetention`    | Every deployment type expires after 1 month                       | Imported        |
| `FirewallConfig`                | Firewall on, bot protection managed ruleset in log mode, no OWASP | Imported        |

The project itself is a `getProject` lookup. Never add a `vercel.Project`
resource: it would own every project setting, including build and env vars.
Every resource was adopted with `import` and carries `protect: true`:
deleting the protection resource, for one, turns preview protection off.

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
  `vars.AWS_ROLE_ARN` for state. Not part of the release train.
- Plugins are installed with the job's `GITHUB_TOKEN` and cached, because the
  automatic download during `preview` is unauthenticated and hits GitHub's rate
  limit on shared runners.

## Gotchas

- **OWASP is off, and declaring it turns it on.** gp-ui's live firewall config
  carries per-category CRS settings but no OWASP ruleset marker. The provider
  sends the marker whenever an `owasp` block is present, so leave it out. Any
  managed-ruleset change is a full `PUT` of the config.
- **Retention's "keep 10 deployments" is not modelled** by the provider; it is
  left as set in Vercel.
- **The provider plugin version** comes from `@pulumiverse/vercel` in
  `package.json`; both workflows read it from there.

## Known gaps and next steps

- **Ops: the apply role.** `github-actions-pulumi-deploy` trusts only omni's
  `main` ref. A job in the `production` environment presents
  `repo:thegoodparty/omni:environment:production`, so thegoodparty/ops must
  trust that subject (or add a role with `pulumiBackendStatements("vercel-config")`)
  before the first apply.
- **Ops: the diff role.** `github-actions-preview-deploy` needs `s3:GetObject`
  on `.pulumi/stacks/vercel-config/prod.json` once the stack exists, or every
  later PR diff fails.
- **The token.** A Vercel owner creates `VERCEL_IAC_TOKEN` and stores it as a
  `production` environment secret.
- **Not managed, on purpose:** gp-ui's Protection Bypass for Automation (its
  import ID is the secret), and the team webhook (its signing secret would land
  in state, which `docs/secrets.md` forbids and the PR diff role can read).
- **Not managed yet:** the other Vercel projects (gp-admin, candidate-sites,
  prototypes), Observability Plus exclusions, and the team spend budget and its
  alerts.

## Verify

`npm run typecheck -w packages/vercel-config`, then
`npm run infra -w packages/vercel-config -- diff` with AWS credentials and a
`VERCEL_API_TOKEN` that can read the team.
