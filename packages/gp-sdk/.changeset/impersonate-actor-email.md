---
'@goodparty_org/sdk': minor
---

Change `AdminResource.impersonateUser` parameter from `actorClerkId` to `actorEmail`. The API now accepts an email address and resolves it to the correct Clerk ID server-side, enabling cross-Clerk-instance impersonation.
