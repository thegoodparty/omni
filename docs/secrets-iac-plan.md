# Plan: write-only secret provisioning

**Status:** the tooling and the release-train wiring are **built and tested**
(Phases 1–2). They are **inert** until an admin completes the
[one-time steps](#one-time-manual-steps-need-an-admin): without the KMS key,
`secret-encrypt.sh` refuses to run and the train's sync stages skip. Nothing
about the current deploy path changes in the meantime.

**Goal.** An engineer or agent can add, rotate, or delete any secret in any
environment through a reviewed PR, holding no AWS credentials and gaining no
ability to read any existing secret value.

**Non-goal.** Giving anyone read access to prod secrets. This plan removes the
reason to want it, which is the only durable way to keep the answer "no".

Delete this file when Phase 5 lands.

## Why the obvious approaches don't work

Worth writing down, because each of these looks like the answer for about an hour.

- **`TF_VAR_*` / tfvars / `pulumi config set`.** Plaintext in state, and state is
  a wider-read surface than the secret. This is the bug Phase 4 fixes, not a
  pattern to build on.
- **SOPS.** The standard choice, and it fails the core requirement: `sops edit`
  decrypts the file's data key to re-encrypt it, so anyone who can add a key can
  read every key in that file. SOPS gives you an audit trail, not write-only
  access.
- **GitHub Environment secrets.** Relocates the trusted human from four AWS
  admins to the GitHub admins, adds a second unmanaged secret store, and gives no
  git history of which key was declared when. Fine as a fallback for a value CI
  itself needs; not the answer for app secrets.
- **Terraform-managed secret versions.** Terraform can own the container but not
  the value: `aws_secretsmanager_secret_version` with a real value puts the
  plaintext in state. The existing `broker` module has this right already — empty
  `jsonencode({})` plus `ignore_changes = [secret_string]`.

## Design

Asymmetric envelope encryption. The engineer encrypts against a **public** key
committed to this repo; only CI holds the private half. Nothing about adding a
secret requires an AWS call, so an agent with no credentials can do the whole
thing.

**KMS key.** One key, `alias/gp-secret-write`, `KeyUsage=ENCRYPT_DECRYPT`,
`KeySpec=RSA_4096`, algorithm `RSAES_OAEP_SHA_256`. Its public key is committed at
`secrets/gp-secret-write.pub.pem` — public by definition, safe in git, and the
thing that makes this credential-free.

**Files.** One per secret per environment, e.g. `secrets/gp-api.prod.yaml`. Each
entry is one independently encrypted, base64 ciphertext keyed by secret name:

```yaml
VENDOR_API_KEY: BASE64_CIPHERTEXT
OTHER_KEY: BASE64_CIPHERTEXT
```

Per-entry encryption (rather than one encrypted document) is what makes it
write-only: adding `VENDOR_API_KEY` never requires decrypting `OTHER_KEY`.

**Encrypting, with no AWS access:**

```bash
printf %s "$VALUE" | openssl pkeyutl -encrypt -pubin \
  -inkey secrets/gp-secret-write.pub.pem \
  -pkeyopt rsa_padding_mode:oaep \
  -pkeyopt rsa_oaep_md:sha256 \
  -pkeyopt rsa_mgf1_md:sha256 | base64
```

**The 446-byte ceiling.** RSA-4096 with OAEP-SHA-256 holds 446 bytes
(512 − 2·32 − 2). API keys and tokens fit; a PEM private key or a cert does not —
`GITHUB_APP_PRIVATE_KEY` in `AI_SECRETS_PROD` is already over it. Those go through
`scripts/secret-encrypt.sh`, which does AES-256-GCM on the value and RSA-wraps the
data key, emitting a tagged `env:` entry the sync step recognizes. Still
openssl-only. Build the script in Phase 1 even if nothing needs it yet, so the
first long value isn't a design decision under time pressure.

**The write happens outside Terraform and Pulumi.** `ci-sync-secrets.sh` decrypts
with `aws kms decrypt` and calls `PutSecretValue` directly. This is the load-bearing
choice: routing it through IaC would put every plaintext back into state and
recreate the problem the plan exists to solve. IaC keeps owning the secret
container, the IAM, and (for gp-ai) which keys are wired.

**A dedicated role.** `github-actions-secrets-sync`, trusted by this repo's OIDC,
holding only `kms:Decrypt` on the one key and
`PutSecretValue`/`GetSecretValue`/`DescribeSecret` on the four named secrets. The
broad `github-actions-pulumi-deploy` role gets no `kms:Decrypt`, so a compromised
Terraform apply can't read the ciphertexts.

### Ordering in the release train

Sync must run **before** the service deploys in each stage. gp-api and
election-api enumerate the live secret's keys at deploy time, so a brand-new key
written after the Pulumi step lands in the blob but isn't in the task definition
until the *next* train — a confusing half-deployed state.

```
dev stage:  sync-secrets(dev)  → service deploys → E2E
prod stage: sync-secrets(prod) → service deploys
```

Sync is idempotent and safe to run when nothing changed, so it can be an
unconditional first step of each stage rather than a path-filtered one.

### Merge and idempotency semantics

- **Read-modify-write**, since one blob holds many keys: read the current secret,
  overlay the declared entries, write back. Never construct the blob from the
  file alone.
- **A live key not present in the file is left alone and reported.** Implicit
  pruning plus a partially migrated file equals wiping prod credentials. Deletion
  is an explicit, separate action (a `--prune` run an admin triggers, or a
  tombstone entry — decide in Phase 3, when there's a real deletion to do).
- **Compare decrypted plaintext against the live value before writing.** OAEP is
  randomized, so re-encrypting an unchanged value produces a different ciphertext;
  the file diff cannot tell you whether a value actually changed. Without the
  plaintext comparison every train cuts a new secret version for every key
  forever.

### Guardrails

- **PR-time validation does no decryption.** It checks that each entry is valid
  base64 and that the ciphertext is exactly 512 bytes for RSA-4096 (or a
  well-formed `env:` envelope). That catches the realistic mistakes — a truncated
  paste, a value encrypted to the wrong key, a plaintext committed by accident —
  with zero AWS access at PR time, so there is no decrypt path a malicious PR can
  turn into an exfiltration path.
- **Block plaintext.** A pre-commit hook plus a CI job that rejects any file under
  `secrets/` whose entries aren't recognized ciphertext. `lint-staged.config.js`
  currently skips YAML, so this needs its own entry.
- **Audit.** Git shows who declared which key and when; CloudTrail shows every
  `PutSecretValue` by the sync role. Neither records values.

## Phases

| Phase | What | Status |
| ----- | ---- | ------ |
| 0 | Ship `docs/secrets.md` so the answer to "I need AWS access" is written down. | **done** |
| 1 | `secret-encrypt.sh` (RSA direct + envelope), `validate-secret-files.sh`, the `secrets/` layout, the pre-commit and CI plaintext guards, and `secret-selftest.sh`. | **done** — waiting on the KMS key |
| 2 | `ci-sync-secrets.sh` plus the `Dev secrets` / `Promote secrets` stages in `release.yml`, ordered before the service deploys and guarded on `vars.AWS_SECRETS_SYNC_ROLE_ARN`. | **done** — waiting on the sync role |
| 3 | Migrate the existing prod blobs' keys into declared files, a few at a time. Settle the deletion mechanism (today the sync reports undeclared keys and never prunes). | outstanding |
| 4 | Close the state leak: drop the `AI_SECRETS_PROD` data source from `prod/shared-infra`, **rotate every key it exposed**, and revoke `GetSecretValue` from the deploy role where it is now unused. | outstanding |
| 5 | Fold the fallback handoff out of `docs/secrets.md` once Phase 3 is complete, and delete this file. | outstanding |

Phases 1 and 2 are code-complete and covered by `secret-selftest.sh`, which
stubs the `aws` CLI and drives the real scripts against a throwaway RSA-4096
keypair (31 assertions: crypto roundtrip both formats, idempotency, no implicit
pruning, environment isolation, and every rejection path). What remains is the
bootstrap, which cannot be self-service, plus the per-secret migration.

Phase 4 needs the rotation, not just the code change: the state bucket has
versioning enabled, so removing the data source leaves the plaintext in every
historical state object. Deleting those versions is an alternative, but rotating
is cheaper to verify than proving an S3 version purge was complete.

## One-time manual steps (need an admin)

The deploy role's IAM policy isn't in IaC, so the bootstrap can't be
self-service. Roughly 20 minutes, once, in the `work` profile / account
`333022194791`.

**1. Create the key and alias.**

```bash
KEY_ID=$(aws kms create-key \
  --key-spec RSA_4096 --key-usage ENCRYPT_DECRYPT \
  --description 'Write-only secret provisioning for omni. Engineers encrypt with the public half; only github-actions-secrets-sync decrypts.' \
  --query KeyMetadata.KeyId --output text)
aws kms create-alias --alias-name alias/gp-secret-write --target-key-id "$KEY_ID"
```

**2. Commit the public key.** It is public by definition — this is what makes the
engineer side credential-free.

```bash
aws kms get-public-key --key-id alias/gp-secret-write \
  --query PublicKey --output text |
  base64 --decode |
  openssl pkey -pubin -inform DER -outform PEM \
  > secrets/gp-secret-write.pub.pem
```

Open that as a PR. `secret-encrypt.sh` asserts the key is RSA-4096, because every
length check in validation derives from that.

**3. Create the sync role.** Trust policy: GitHub's OIDC provider, restricted to
**`main` specifically** — not the repo as a whole.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::333022194791:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:thegoodparty/omni:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

`StringEquals` on the full `sub`, with no wildcard, is the load-bearing part.
A repo-wide `repo:thegoodparty/omni:*` would match every ref in the repo, so
**pushing a branch** — no review, no merge — would be enough to run a workflow
that assumes this role and either `kms:Decrypt`s the committed ciphertexts or
reads the prod secrets outright. That is the entire write-only property, gone,
via the one action every engineer can already take. Pinned to `main`, the only
automatic path to this role is a commit that survived PR review.

One residual path stays open by design: `workflow_dispatch` runs on `main` while
checking out an arbitrary `sha`, so someone with write access can run this role
against un-merged code. That is the same trust the break-glass `force` already
assumes, and it is deliberate and logged rather than silent. Step 5's CODEOWNERS
is what keeps it behind a second pair of eyes.

Permissions — and nothing else:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "arn:aws:kms:us-west-2:333022194791:key/<KEY_ID>"
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:PutSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": [
        "arn:aws:secretsmanager:us-west-2:333022194791:secret:GP_API_*",
        "arn:aws:secretsmanager:us-west-2:333022194791:secret:ELECTION_API_*",
        "arn:aws:secretsmanager:us-west-2:333022194791:secret:AI_SECRETS_*",
        "arn:aws:secretsmanager:us-west-2:333022194791:secret:broker-*"
      ]
    }
  ]
}
```

`GetSecretValue` is needed for the read-modify-write and the idempotency
comparison, not just the write. Do **not** grant `kms:Decrypt` to
`github-actions-pulumi-deploy`: keeping it off the broad deploy role is what
stops a compromised terraform apply from reading the ciphertexts.

**4. Set `vars.AWS_SECRETS_SYNC_ROLE_ARN`** (Settings → Secrets and variables →
Actions → Variables). Until this is set, both sync stages skip, which is why
merging the pipeline ahead of the bootstrap is safe.

**5. Add `CODEOWNERS`** (there is none today) requiring admin review on
`secrets/**`, so prod secret PRs keep a human gate — and on
`scripts/secrets/**` and `.github/workflows/release.yml`, because with the trust
policy pinned to `main`, merging a change to the sync script or the job that
runs it is the remaining way to turn `kms:Decrypt` into a printed plaintext.

**Verify**, with no secret at risk — encrypt a throwaway value into dev, let a
train run, confirm it lands, then delete the key:

```bash
printf %s "canary-$(date +%s)" | scripts/secrets/secret-encrypt.sh \
  --secret-id GP_API_DEV secrets/gp-api.dev.json PIPELINE_CANARY
```

## Open questions

- **Do engineers keep dev read/write?** Several docs assume they can run
  `get-secret-value` against `AI_SECRETS_DEV` (see
  `packages/gp-ai/shared/docs/braintrust.md`). Recommend yes, unchanged — dev
  values are rotatable and low-consequence, and the friction this plan removes is
  about prod.
- **Who approves a prod secret PR?** Recommend a required review from the admin
  group via `CODEOWNERS`. Jeff keeps the review gate he's asking for; what goes
  away is the admin doing the mechanical work.
- **Who can read the two state buckets** (`goodparty-terraform-state-us-west-2`,
  `goodparty-iac-state`) today? This determines how urgent Phase 4 is and whether
  the current "no prod secret access" posture is real.
- **Rotation policy** — cadence, and who owns noticing an expiring credential.
  Out of scope here, but this plan makes rotation cheap enough to have a policy.
