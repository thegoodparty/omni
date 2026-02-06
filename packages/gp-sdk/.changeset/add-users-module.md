---
"@goodparty_org/sdk": minor
---

Add User CRUD module with M2M token authentication

- Introduce modular resource architecture (BaseResource, HttpClient, UsersResource)
- Add `client.users.get(id)`, `client.users.delete(id)`, `client.users.updatePassword(id, input)`, and `client.users.list(options?)` methods
- Use `ofetch` for HTTP requests with automatic JSON handling, baseURL resolution, and unified error handling
- Export typed `User`, `UserRole`, `UserMetaData`, `UpdatePasswordInput`, `SdkError`, `PaginatedList`, `PaginationOptions`, and `PaginationMeta`
- Throw `SdkError` (extends Error) on failed requests with status, message, and optional raw Response
