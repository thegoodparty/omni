# Secrets

**You can add or rotate any secret yourself, including a prod one, and you can
never read one.** No admin does the mechanical work, and no task in this repo
needs a prod value in hand. If you are about to ask a human to paste a secret to
you, or to grant you read access, stop and read this file.

What you do need, once: the **write-only secrets profile** — an AWS profile that
can `s3:PutObject` to the payload bucket and nothing else. It cannot read a
secret, list one, or decrypt anything, in any environment. Setting it up is a
one-time thing per machine, not a per-secret access request.

## Never ask to read a secret

Agents must not ask a human to paste a secret value into chat, a PR, or a ticket,
and must not ask for `GetSecretValue`, `kms:Decrypt`, a console login, or any
grant beyond the write-only profile. Standing read access to prod secrets is the
thing we deliberately don't hand out — malware, a confused agent, and a
fat-fingered `update-secret` all do the same damage, and the point of the setup
below is that none of them can.

If the profile isn't configured on the machine, that is a one-line setup step to
hand back to the user, not a reason to ask for the value. See
[Adding or rotating a secret](#adding-or-rotating-a-secret). If the bootstrap
isn't finished at all, there's a
[slower admin handoff](#the-admin-handoff-fallback) for the interim.

## Two separate acts: uploading and promoting

This is the part worth understanding before you run anything, because it is why
you can hold a write credential without that being dangerous.

| Act         | What it is                                     | Reviewed? | Effect             |
| ----------- | ---------------------------------------------- | --------- | ------------------ |
| **Upload**  | `PutObject` of a ciphertext to the S3 bucket   | no        | **none** — inert   |
| **Promote** | a one-line manifest diff naming the version id | yes, PR   | deploys that value |

Nothing reads an S3 object until a manifest in `secrets/` pins its version id on
`main`. So uploading is safe to leave unreviewed: an uploaded payload no one
merged is unreachable. The reviewed act is the promotion, which is a normal diff
with CODEOWNERS on it — and reverting that PR is a rollback, with no
re-encryption, because the older version is still in the bucket.

Payloads live in S3 rather than in git because **this repo is public.** A
committed ciphertext is world-readable and permanently archived by third parties;
strong encryption today is not strong encryption for the lifetime of the
credential, and a public commit cannot be withdrawn.

## Where secrets live

Each row is **one** AWS Secrets Manager secret holding a flat JSON object of
string keys. There is no per-key secret and no SSM parameter for app secrets.

| Secret                             | Consumed by                       | Environments      |
| ---------------------------------- | --------------------------------- | ----------------- |
| `GP_API_PROD` / `GP_API_DEV`       | gp-api ECS tasks                  | prod / dev + preview |
| `ELECTION_API_PROD` / `_DEV`       | election-api ECS tasks            | prod / dev        |
| `AI_SECRETS_PROD` / `AI_SECRETS_DEV` | gp-ai Terraform roots (Fargate + Lambda) | prod / dev |
| `broker-<env>`                     | PMF broker only                   | prod / dev        |

preview stacks share the `*_DEV` secrets — there is no preview secret.

## How a secret reaches running code

The ECS task definition carries a `secrets` block whose `valueFrom` is
`<secret-arn>:<KEY>::`. ECS resolves it at task start and injects it as an
environment variable, so the value lives only in the running container: not in an
image, not in a `.env`, not in Pulumi or Terraform state.

The two stacks differ in how a key gets into that block, which decides whether
adding one needs a code change:

- **gp-api and election-api need no code change.** The Pulumi program reads the
  live secret and enumerates its keys, wiring every one it finds
  (`Object.keys(secret)` in `packages/*/deploy/index.ts`). A key that exists in
  the blob is in the task definition on the next deploy.
- **gp-ai needs a Terraform edit.** Each key is listed explicitly in the module's
  `secrets` array, so a new one means a new `valueFrom` entry plus an
  `AI_SECRETS_<ENV>` resource in the task role's IAM policy.

`SECRET_NAMES` is set from the same key list and drives log redaction
(`packages/nest-common/src/observability/log-redaction.ts`), so a key added to the
blob is automatically scrubbed from logs. That only covers the Node services —
gp-ai does its own redaction.

**Don't copy the one pattern that breaks this.**
`packages/gp-ai/infrastructure/environments/prod/shared-infra/main.tf` pulls the
whole `AI_SECRETS_PROD` blob through `data "aws_secretsmanager_secret_version"`.
Terraform writes data source results to state in **plaintext**, so that one root
puts every prod AI secret into the state bucket. Never add a data source, a
`TF_VAR_*`, or a Pulumi config value that carries a secret value — use
`valueFrom` and let the runtime resolve it. Closing that specific leak is Phase 4
of `docs/secrets-iac-plan.md`.

## Adding or rotating a secret

One command, then one PR. The value is encrypted against the public key committed
at `secrets/gp-secret-write.pub.pem` **before it leaves your machine**, so the
write-only profile never sees a plaintext; the release train decrypts it with a
role only CI can assume and writes it to Secrets Manager. You cannot read back
what you or anyone else wrote.

```bash
# Encrypts, uploads the ciphertext, and records the version id it got back.
# Reads stdin, so the value never reaches your shell history or `ps` output.
# Creates the manifest if it doesn't exist yet.
printf %s "$VALUE" | scripts/secrets/secret-encrypt.sh \
  --secret-id GP_API_PROD secrets/gp-api.prod.json VENDOR_API_KEY

# Then commit secrets/gp-api.prod.json. That one-line diff is the promotion.
```

The manifest holds only key names and version ids, so the diff a reviewer reads
is "this key was rotated" — which is all a reviewer can usefully check, since a
ciphertext is unreadable by definition.

Values over 446 bytes (PEM keys, certs) automatically switch to an envelope
format — that's the RSA-OAEP ceiling, not a policy — and need nothing extra from
you. Exactly one trailing newline is stripped by default, because `echo "$KEY" |`
is the common invocation and a stray `\n` silently breaks API auth; any earlier
newlines are kept, and `--raw` preserves the bytes verbatim.

The secret named by `--secret-id` has to belong to the file's environment — a
`*.dev.json` cannot write `GP_API_PROD`. The dev sync runs before the E2E, so
crossing that line would be a way to change prod without passing the gate.

The value lands in Secrets Manager once the manifest change is on `main`, in the
train stage that runs before the services deploy. Rotating is the same command
with a new value. Deleting a key is a separate, explicit step — the sync never
prunes, so removing an entry from the manifest leaves the live value alone and
reports it.

**Prerequisites.** Until an admin completes the one-time steps in
`docs/secrets-iac-plan.md` (KMS key, committed public key, versioned payload
bucket, the write-only and sync roles, `vars.AWS_SECRETS_SYNC_ROLE_ARN`),
`secret-encrypt.sh` exits with a message naming what is missing and the train's
sync stages skip. In that window, use the
[admin handoff](#the-admin-handoff-fallback) below — but check first, because the
handoff is the slow path.

### What you still have to wire

Encrypting the value does not wire it into a running service:

1. **Check it needs to be a secret at all.** A hostname, bucket name, ARN, or
   feature flag is an environment variable. Put it in `environmentVariables`
   (gp-api/election-api) or a Terraform variable and skip all of this.
2. **Name it** in `SCREAMING_SNAKE_CASE`, matching what the vendor calls it
   (`BRAINTRUST_API_KEY`, not `BT_KEY`). Same name in every environment — the
   environment is the secret, not the key.
3. **gp-ai only:** add the `valueFrom` entry to the module's `secrets` array and
   extend the task role's `secretsmanager:GetSecretValue` statement, both in
   `packages/gp-ai/infrastructure/modules/<service>/main.tf`. gp-api and
   election-api need nothing — they enumerate the live keys.
4. **Handle the value being absent.** Your code may deploy before the value
   exists. Don't crash-loop on a missing key: the ECS circuit breaker will roll
   the service back and the deploy will look like an unrelated failure. Fail the
   specific feature, not boot, unless the service genuinely cannot serve without
   it.

### The admin handoff (fallback)

Only needed while `secrets/gp-secret-write.pub.pem` is missing. Wire everything
as above, open the PR, then post one message in `#devs-only`:

> Secret value write needed for <PR link>.
> Secret: `GP_API_PROD`
> Key: `VENDOR_API_KEY`
> Where the value comes from: <vendor dashboard / who issued it>
> Needs to land: before/after the PR merges

Send the value itself through 1Password, not Slack. Admins who can do this write:
Tomer, Dan, Swain, Jeff.

## Tooling

| Script                                     | What                                                            | Needs AWS?                   |
| ------------------------------------------ | --------------------------------------------------------------- | ---------------------------- |
| `scripts/secrets/secret-encrypt.sh`        | Encrypt, upload the payload, record the version id              | yes — write-only, PutObject  |
| `scripts/secrets/validate-secret-files.sh` | Manifest check; runs pre-commit and on every PR                 | no                           |
| `scripts/secrets/secret-selftest.sh`       | End-to-end test against a throwaway keypair and a stubbed `aws` | no                           |
| `scripts/secrets/ci-sync-secrets.sh`       | Fetch the pinned payloads, decrypt, write; release train only   | yes — the sync role          |

Validation never decrypts and needs no credentials at all, not even S3 read:
a PR-time job holding `kms:Decrypt` would be a read path into every secret, and a
PR can edit the workflow that runs it. From the manifest alone it still catches a
plaintext pasted where a version id belongs, a raw ciphertext committed into this
public repo, a `null` version id (which would mean the bucket lost versioning and
the manifest had stopped pinning anything), a cross-environment `secretId`, and a
stray file in `secrets/`.

What it can't see is the payload: a truncated or wrong-key ciphertext, or a
version id that doesn't exist. Those fail on the train — and in the **dev** stage,
which fetches and decrypts *both* environments' payloads before any deploy, so a
bad prod payload stops the train rather than a prod promotion.

## You cannot read a prod value, and you don't need to

Every real reason for wanting one has a better answer:

| You want the value because                     | Do this instead                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| A prod call is 401/403ing                      | Read the failure in Loki via the Grafana MCP. The response body says whether the key is missing, malformed, expired, or scoped wrong — enough to act on. See `docs/observability.md`. |
| You need to confirm a key is set               | `aws secretsmanager describe-secret` and the `SECRET_NAMES` env var both list key **names** without values; an admin can confirm presence in a sentence. |
| You're testing an integration locally          | Use your own sandbox credential from the vendor, in your gitignored `.env`. Never a prod one. |
| You're reproducing a prod-only bug             | Reproduce against dev with a dev credential. If it only reproduces with the prod key, the bug is in the key's configuration at the vendor, not in the code. |
| A vendor call needs to run once, against prod  | Ask an admin to run it, or add it as a one-shot script the deployed service runs with its task role. |

## Local development

Local secrets live in a gitignored `.env` per package (`.env.example` lists the
keys). Fill it with dev or personal sandbox credentials. Never put a prod value in
a `.env`, a test fixture, a snapshot, a commit message, or a PR comment — a prod
value that touches a developer laptop is a rotation, not a shortcut.

## Rules

- **Never commit a plaintext secret.** If you do, it is burned: rotate it, don't
  just amend the commit. Git history and every CI log that saw it keep the value,
  and because this repo is public, so does anyone who mirrors it.
- **Never commit a ciphertext either.** Payloads go to the bucket; the repo gets
  a version id. Validation rejects a raw ciphertext for this reason — a public
  commit cannot be withdrawn, and "encrypted today" is not "encrypted forever".
- **Never print a secret.** No `console.log`, no debug print, no dumping
  `process.env` in a test.
- **Never pass a secret through Terraform or Pulumi.** No data sources, no
  `TF_VAR_*`, no `pulumi config set`. It lands in state, which is a wider-read
  surface than the secret itself.
- **One key, every environment.** Same name in dev and prod, different values.
  Add it to both files in the same PR. A key in only one of them is a warning,
  not an error — validation prints it, because a prod key missing at runtime is
  otherwise invisible until the service reads it, well after a green train.
- **A secret that leaves the account is rotated, not reused.**
