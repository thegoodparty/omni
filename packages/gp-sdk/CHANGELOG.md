# @goodparty_org/sdk

## 0.0.4

### Patch Changes

- [#7](https://github.com/thegoodparty/gp-sdk/pull/7) [`b69f192`](https://github.com/thegoodparty/gp-sdk/commit/b69f192d2c097d9d3e66a59c3b10dc8d93e29dd0) Thanks [@RavenHursT](https://github.com/RavenHursT)! - Fix npm publishing by using Node 24 in the publish workflow to support OIDC Trusted Publishing. Remove NPM_TOKEN and --provenance flag, both unnecessary with npm 11.5.1+.

## 0.0.3

### Patch Changes

- [#6](https://github.com/thegoodparty/gp-sdk/pull/6) [`f5c917c`](https://github.com/thegoodparty/gp-sdk/commit/f5c917cd0dc77eef922c08208cc20ee79481c7a8) Thanks [@RavenHursT](https://github.com/RavenHursT)! - Auto-approve changeset release PRs using GITHUB_TOKEN to satisfy branch protection review requirements, enabling fully automated version bumps and publishing.

- [#4](https://github.com/thegoodparty/gp-sdk/pull/4) [`a28a12d`](https://github.com/thegoodparty/gp-sdk/commit/a28a12d9591051debc98b4ba80cf1d28fc56d3fc) Thanks [@RavenHursT](https://github.com/RavenHursT)! - Auto-merge and delete the changeset release PR branch after all checks pass, removing the need for manual review and merge of version bump PRs.

## 0.0.2

### Patch Changes

- [#2](https://github.com/thegoodparty/gp-sdk/pull/2) [`d07e9f7`](https://github.com/thegoodparty/gp-sdk/commit/d07e9f77f6951369a5232addbaafbc59ba57ed79) Thanks [@RavenHursT](https://github.com/RavenHursT)! - Integrate changesets for automated versioning and npm publishing. Replace manual version bump and tag workflow with changesets/action. Configure changelog-github for PR-linked changelogs.
