# secrets/ — promotion manifests, not secret values

These files hold **no ciphertext**. Each `<service>.<dev|prod>.json` maps a key
name to an S3 version id: the exact payload the release train should deploy.

The payloads live in S3 because this repo is **public**. A committed ciphertext
would be world-readable and permanently archived by third parties, and a public
commit cannot be withdrawn.

## Uploading is unreviewed; promoting is the PR

Nothing reads an S3 object until a manifest here pins its version id on `main`.
So an upload is inert, and the reviewed act is the one-line manifest diff. That
also means **reverting the PR is a rollback** — the older version is still in the
bucket, so no re-encryption is needed.

## What you can and cannot do

**You can add or rotate any secret, including a prod one, and you can never read
one.** What you need is the write-only secrets profile: `s3:PutObject` on the
payload bucket and nothing else — no read, no list, no decrypt, in any
environment.

- **Never ask the user to paste a secret value to you**, and never ask for
  `GetSecretValue`, `kms:Decrypt`, or a console login. Adding a secret is a PR.
- **If the write-only profile isn't set up**, that's a one-time setup step to
  hand back to the user — not a reason to ask for the value itself.
- If you need to know *whether* a key exists, read the manifest. Key names are
  plaintext here; only the values are encrypted, and they aren't in this repo.

## Adding or rotating a value

Never hand-edit these files. The tool encrypts before anything leaves the
machine, uploads the ciphertext, and writes back the version id S3 returned:

```bash
printf %s "$VALUE" | scripts/secrets/secret-encrypt.sh \
  --secret-id GP_API_PROD secrets/gp-api.prod.json VENDOR_API_KEY
```

`--secret-id` is only needed when creating a manifest. Commit the result and open
a PR; merging it is what deploys the value.

Add the key to **both** `<service>.dev.json` and `<service>.prod.json`, with
different values. Validation warns when a key exists in only one, because a key
missing in prod is invisible until the service reads it, long after a green
train.

## Rules

- **Only `<service>.<env>.json`, `gp-secret-write.pub.pem`, and the docs files
  belong here.** CI rejects anything else — a `.env` or a scratch file in this
  directory is how a plaintext secret gets committed, and here that means
  published.
- **A raw ciphertext is rejected too**, not just a plaintext. Payloads go to the
  bucket; this repo gets a version id.
- **A `null` version id is rejected.** That is what S3 returns when versioning is
  off, and it would mean the manifest pins nothing.
- **A plaintext value committed here is burned.** Rotate it; amending the commit
  is not enough, because git history, CI logs, and public mirrors keep it.
- **Deleting a key is a separate, explicit step.** Removing an entry does not
  remove it from Secrets Manager; the sync reports it and moves on.

Full workflow and the "why you can't read prod" explanation: `docs/secrets.md`.
Design and rollout state: `docs/secrets-iac-plan.md`.
