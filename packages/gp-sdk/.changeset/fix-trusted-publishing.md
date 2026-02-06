---
"@goodparty_org/sdk": patch
---

Fix npm publishing by using Node 24 in the publish workflow to support OIDC Trusted Publishing. Remove NPM_TOKEN and --provenance flag, both unnecessary with npm 11.5.1+.
