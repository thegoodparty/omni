# Rotate the GHCR pull credential (Astro private image pulls)

The GitHub token that lets our Airflow pods pull private container images expires roughly
yearly. When it lapses, every private image pull fails at once (`ImagePullBackOff`), pods
never start, and there is no graceful degradation and no warning at pull time. This is the
rotation procedure and the context an operator needs to run it cold.

## What this credential is

- A GitHub **machine account**, `goodparty-system` (inbox: eng-admin@goodparty.org).
  Account password, TOTP seed, and the current token live in the shared 1Password item
  **"eng-admin github system user"**, along with the token's expiry date.
- The token is a **classic personal access token** with the single scope `read:packages`
  and a one-year expiry (first minted 2026-09-08). A shared calendar reminder should sit
  about two weeks before each expiry.
- It backs the Kubernetes docker-registry secret named **`ghcr-pull`** in BOTH Astronomer
  deployment namespaces (astro-dev and astro-prod). Astronomer support creates and updates
  that secret; it is not self-serve on Astro Hosted.

## What depends on it

Every Airflow pipeline that launches KubernetesPodOperator pods pulling private images from
ghcr.io — as of 2026-09: the matcha entity-resolution DAG, the gold-match daily DAG, and
the reverse-ETL DAG. Each references the secret by name through an Airflow Variable (for
example `gold_match_image_pull_secret`). New packages published by CI are readable by the
account automatically (packages inherit repository access; verified 2026-09-09 by pulling a
package created after the token was minted).

## Rotation procedure (about 30 minutes hands-on, plus support turnaround)

1. Sign in to GitHub as `goodparty-system` in a private browser window (credentials from
   the 1Password item).
2. Settings, Developer settings, Personal access tokens, Tokens (classic): generate a new
   token with the single scope `read:packages`, one-year expiry, named self-datingly, for
   example "astro-ghcr-pull, rotate by <month year>".
3. Save the new token and its exact expiry into the 1Password item, and move the shared
   calendar reminder to about two weeks before the new expiry.
4. Pre-flight locally, so any access problem is found before support gets involved:

   ```bash
   echo "$TOKEN" | docker login ghcr.io -u goodparty-system --password-stdin
   docker pull ghcr.io/<org>/<any private package>:latest
   docker logout ghcr.io
   ```

5. Build the credentials payload directly (Docker Desktop on macOS hides credentials in
   the keychain, so its own config file is not usable):

   ```bash
   printf '{"auths":{"ghcr.io":{"auth":"%s"}}}' \
     "$(printf 'goodparty-system:%s' "$TOKEN" | base64)" > /tmp/ghcr-config.json
   ```

   The `auth` value is base64 of `username:token` — that is the file format, encoding not
   encryption; the secrecy comes from the next step.
6. Paste the file's content into a one-time secret at https://ots.astro-cre.com and copy
   the link. Do NOT open the link yourself — the first read burns it. Delete
   `/tmp/ghcr-config.json` immediately after.
7. Open an Astronomer support ticket asking them to UPDATE the existing `ghcr-pull` secret
   in both deployment namespaces from the one-time-secret link (precedent: ticket #98163;
   secrets are namespace/deployment scoped; typical turnaround is same-day).
8. Verify a pod-level pull in each deployment (trigger any container DAG's pod on dev, or
   ask support to test-pull an image), then revoke the OLD token on the account and note
   the rotation date in the 1Password item.

## Constraints (do not "improve" these away)

- GHCR accepts ONLY classic personal access tokens for registry pulls. Fine-grained tokens
  and GitHub App installation tokens are refused at pull time (a login can appear to
  succeed and the pull still fails "denied"). Verified 2026-09-08 against GitHub's docs and
  community reports.
- IAM-style pulls do not exist for GHCR ("we cannot communicate with GitHub Container
  Registry via IAM" — Astronomer support, 2026-09-08). The static secret is the supported
  path on Astro Hosted.
- Astro namespace secrets are support-managed: no self-serve create, update, or rotation.
- The account is a GitHub Terms-of-Service "machine account" (an explicitly permitted
  category: a human owner is responsible, it is used exclusively for automation). It
  occupies one paid org seat. Future automation should reuse this account with additional,
  separately-scoped tokens rather than creating another account.
- Unrelated to this credential but also surfacing at pod launch: if the deployment-wide
  `databricks_scopes` Airflow Variable is ever set (a narrowed Databricks service-principal
  secret), the gold-match pipeline refuses to launch pods by design until its client
  supports scopes. Do not confuse that failure with a registry-pull failure.
