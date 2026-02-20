# @goodparty_org/sdk

## 1.8.0

### Minor Changes

- [#35](https://github.com/thegoodparty/gp-sdk/pull/35) [`565f99b`](https://github.com/thegoodparty/gp-sdk/commit/565f99b9722c6beb39fbcacbcdd4826988959b2a) Thanks [@tomer-tgp](https://github.com/tomer-tgp)! - Add ElectedOffice resource with list, get, and update methods

## 1.7.0

### Minor Changes

- [#30](https://github.com/thegoodparty/gp-sdk/pull/30) [`7e5b3e4`](https://github.com/thegoodparty/gp-sdk/commit/7e5b3e4b04b2514c770b817b4c1a46c40dd556a2) Thanks [@tomer-tgp](https://github.com/tomer-tgp)! - Add `campaigns.get(id)` method to fetch a single campaign by ID

- [#32](https://github.com/thegoodparty/gp-sdk/pull/32) [`3723793`](https://github.com/thegoodparty/gp-sdk/commit/3723793b378c70755b49256fd158d09797d5c992) Thanks [@RavenHursT](https://github.com/RavenHursT)! - Add abstract `resourceBasePath` to `BaseResource` to enforce path definition on extending classes, replacing hardcoded path strings in `CampaignsResource` and `UsersResource`

## 1.6.0

### Minor Changes

- [#29](https://github.com/thegoodparty/gp-sdk/pull/29) [`3e22bd3`](https://github.com/thegoodparty/gp-sdk/commit/3e22bd35b701f4d4c2ba9f73a9d8e0f643358689) Thanks [@tomer-tgp](https://github.com/tomer-tgp)! - Add PathsToVictory resource with list, get, and update methods, along with supporting types and enums

## 1.5.1

### Patch Changes

- [#28](https://github.com/thegoodparty/gp-sdk/pull/28) [`ae92ecb`](https://github.com/thegoodparty/gp-sdk/commit/ae92ecb2e6ee6d7e4283e415471ee8f8fa8f8d92) Thanks [@tomer-tgp](https://github.com/tomer-tgp)! - Remove incorrect fields from CampaignDetails and CampaignData that were not in the API schema, add missing einSupportingDocument field, and remove unused helper types (TopIssuePosition, CampaignFinance, CampaignPlan, CampaignPlanStatus) to align SDK types with campaign.jsonTypes.d.ts

## 1.5.0

### Minor Changes

- [`dbff349`](https://github.com/thegoodparty/gp-sdk/commit/dbff349a52f350e90fdf8f5284b96e59082e20b8) Thanks [@tomer-tgp](https://github.com/tomer-tgp)! - Add named types for campaign sub-objects (CampaignFinance, CampaignPlan, TopIssuePosition, GeoLocation, CustomIssue, Opponent, etc.) and expand CampaignDetails and CampaignData with missing fields to align with the API schema

## 1.4.0

### Minor Changes

- [#25](https://github.com/thegoodparty/gp-sdk/pull/25) [`7ce5da0`](https://github.com/thegoodparty/gp-sdk/commit/7ce5da0c911651734510c9bd49b51c5a36c99532) Thanks [@tomer-tgp](https://github.com/tomer-tgp)! - Add metaData to UpdateUserInput for updating user metadata via the admin endpoint

## 1.3.0

### Minor Changes

- [#23](https://github.com/thegoodparty/gp-sdk/pull/23) [`1f44cff`](https://github.com/thegoodparty/gp-sdk/commit/1f44cff62300e325e35b322fdd9e32de66f41a6b) Thanks [@tomer-tgp](https://github.com/tomer-tgp)! - Add CampaignsResource with list and update operations

## 1.2.0

### Minor Changes

- [#21](https://github.com/thegoodparty/gp-sdk/pull/21) [`53c9486`](https://github.com/thegoodparty/gp-sdk/commit/53c94868c56bfe94832d73d74eb505e77d41bec9) Thanks [@tomer-tgp](https://github.com/tomer-tgp)! - Add user update method to UsersResource

## 1.1.0

### Minor Changes

- [#19](https://github.com/thegoodparty/gp-sdk/pull/19) [`1551a0c`](https://github.com/thegoodparty/gp-sdk/commit/1551a0c11a89965c1ff81fe6d95a6199967c9d46) Thanks [@RavenHursT](https://github.com/RavenHursT)! - Extract M2M token provisioning into ClerkService with automatic renewal before expiration

## 1.0.0

### Major Changes

- [#17](https://github.com/thegoodparty/gp-sdk/pull/17) [`2457df3`](https://github.com/thegoodparty/gp-sdk/commit/2457df3f1c66a8110fad12baef910cbf4baa6512) Thanks [@RavenHursT](https://github.com/RavenHursT)! - Align users list endpoint with gp-api contract
  - **BREAKING**: `PaginationOptions` now uses `offset` instead of `page`, adds `sortBy` and `sortOrder`
  - **BREAKING**: `PaginationMeta` now uses `offset` instead of `page`, removes `totalPages`
  - **BREAKING**: `PaginatedList<T>` now uses `meta` instead of `pagination`
  - Add `ListUsersOptions` type with `firstName`, `lastName`, `email` filter fields
  - Simplify `UsersResource.list` to pass through API response directly

## 0.1.0

### Minor Changes

- [#15](https://github.com/thegoodparty/gp-sdk/pull/15) [`a070e2e`](https://github.com/thegoodparty/gp-sdk/commit/a070e2ee50b06ce28fb9e2681441beb84421cf8c) Thanks [@RavenHursT](https://github.com/RavenHursT)! - Add User CRUD module with M2M token authentication
  - Introduce modular resource architecture (BaseResource, HttpClient, UsersResource)
  - Add `client.users.get(id)`, `client.users.delete(id)`, `client.users.updatePassword(id, input)`, and `client.users.list(options?)` methods
  - Use `ofetch` for HTTP requests with automatic JSON handling, baseURL resolution, and unified error handling
  - Export typed `User`, `UserRole`, `UserMetaData`, `UpdatePasswordInput`, `SdkError`, `PaginatedList`, `PaginationOptions`, and `PaginationMeta`
  - Throw `SdkError` (extends Error) on failed requests with status, message, and optional raw Response

## 0.0.7

### Patch Changes

- [#13](https://github.com/thegoodparty/gp-sdk/pull/13) [`bac3bd6`](https://github.com/thegoodparty/gp-sdk/commit/bac3bd6be73d938afebd4f90cdce838bf561cbf6) Thanks [@RavenHursT](https://github.com/RavenHursT)! - Fix GitHub Release creation by using gh CLI directly instead of relying on changesets/action createGithubReleases, which fails silently with app tokens on scoped packages.

- [#13](https://github.com/thegoodparty/gp-sdk/pull/13) [`bac3bd6`](https://github.com/thegoodparty/gp-sdk/commit/bac3bd6be73d938afebd4f90cdce838bf561cbf6) Thanks [@RavenHursT](https://github.com/RavenHursT)! - Use changeset publish instead of npm publish so the changesets action correctly sets the published output, enabling the GitHub Release creation step.

- [#13](https://github.com/thegoodparty/gp-sdk/pull/13) [`bac3bd6`](https://github.com/thegoodparty/gp-sdk/commit/bac3bd6be73d938afebd4f90cdce838bf561cbf6) Thanks [@RavenHursT](https://github.com/RavenHursT)! - Add repository URL to package.json, required by npm Trusted Publishing to validate provenance against the GitHub repo.

- [#13](https://github.com/thegoodparty/gp-sdk/pull/13) [`bac3bd6`](https://github.com/thegoodparty/gp-sdk/commit/bac3bd6be73d938afebd4f90cdce838bf561cbf6) Thanks [@RavenHursT](https://github.com/RavenHursT)! - Fix npm publishing by using Node 24 in the publish workflow to support OIDC Trusted Publishing. Remove NPM_TOKEN and --provenance flag, both unnecessary with npm 11.5.1+.

## 0.0.6

### Patch Changes

- [#11](https://github.com/thegoodparty/gp-sdk/pull/11) [`0abc058`](https://github.com/thegoodparty/gp-sdk/commit/0abc058cccc381dcfe661284f8628dfc9ea07772) Thanks [@RavenHursT](https://github.com/RavenHursT)! - Fix GitHub Release creation by using gh CLI directly instead of relying on changesets/action createGithubReleases, which fails silently with app tokens on scoped packages.

- [#11](https://github.com/thegoodparty/gp-sdk/pull/11) [`0abc058`](https://github.com/thegoodparty/gp-sdk/commit/0abc058cccc381dcfe661284f8628dfc9ea07772) Thanks [@RavenHursT](https://github.com/RavenHursT)! - Add repository URL to package.json, required by npm Trusted Publishing to validate provenance against the GitHub repo.

- [#11](https://github.com/thegoodparty/gp-sdk/pull/11) [`0abc058`](https://github.com/thegoodparty/gp-sdk/commit/0abc058cccc381dcfe661284f8628dfc9ea07772) Thanks [@RavenHursT](https://github.com/RavenHursT)! - Fix npm publishing by using Node 24 in the publish workflow to support OIDC Trusted Publishing. Remove NPM_TOKEN and --provenance flag, both unnecessary with npm 11.5.1+.

## 0.0.5

### Patch Changes

- [#9](https://github.com/thegoodparty/gp-sdk/pull/9) [`a665008`](https://github.com/thegoodparty/gp-sdk/commit/a665008d9658c304a34037d7edad55ae4d94e87b) Thanks [@RavenHursT](https://github.com/RavenHursT)! - Add repository URL to package.json, required by npm Trusted Publishing to validate provenance against the GitHub repo.

- [#9](https://github.com/thegoodparty/gp-sdk/pull/9) [`a665008`](https://github.com/thegoodparty/gp-sdk/commit/a665008d9658c304a34037d7edad55ae4d94e87b) Thanks [@RavenHursT](https://github.com/RavenHursT)! - Fix npm publishing by using Node 24 in the publish workflow to support OIDC Trusted Publishing. Remove NPM_TOKEN and --provenance flag, both unnecessary with npm 11.5.1+.

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
