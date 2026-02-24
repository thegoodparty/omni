---
"@goodparty_org/sdk": minor
---

Replace duplicated local types with imports from @goodparty_org/contracts.

- User types (ReadUserOutput, UpdatePasswordInput, PaginatedList, PaginationMeta, SIGN_UP_MODE) now come from contracts
- Resource files import directly from @goodparty_org/contracts instead of local type files
- Removed duplicated type definitions from src/types/user.ts and src/types/result.ts
- Added @goodparty_org/contracts as a dependency
- Re-export ReadUserOutput as User for backward compatibility
