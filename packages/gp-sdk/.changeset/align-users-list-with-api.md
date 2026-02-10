---
"@goodparty_org/sdk": major
---

Align users list endpoint with gp-api contract

- **BREAKING**: `PaginationOptions` now uses `offset` instead of `page`, adds `sortBy` and `sortOrder`
- **BREAKING**: `PaginationMeta` now uses `offset` instead of `page`, removes `totalPages`
- **BREAKING**: `PaginatedList<T>` now uses `meta` instead of `pagination`
- Add `ListUsersOptions` type with `firstName`, `lastName`, `email` filter fields
- Simplify `UsersResource.list` to pass through API response directly
