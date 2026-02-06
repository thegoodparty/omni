---
"@goodparty_org/sdk": patch
---

Fix GitHub Release creation by using gh CLI directly instead of relying on changesets/action createGithubReleases, which fails silently with app tokens on scoped packages.
