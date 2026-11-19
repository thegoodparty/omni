# API clients

Two systems coexist in `gpApi/`. The typed system is canonical; the legacy helpers are deprecated.

## Decision tree

```
New code? ─────────────────► clientRequest / serverRequest (typed)
Existing legacy call?  ────► leave as-is OR port (see migrate-legacy-fetch skill)
```

## Typed (canonical)

- `clientRequest` — `gpApi/typed-request.ts`. Browser / client components.
- `serverRequest` — `gpApi/server-request.ts`. Server components, route handlers, `'use server'`. A page's data still loads in the browser by default; a page's server render uses `serverRequest` only to decide access or a 404 (`docs/state-management.md` § Load gp-api data in the browser).
- Routes are typed keys in `APIEndpoints` (`gpApi/api-endpoints.ts`): `'METHOD /path/:param'`.
- Returns `{ ok, status, data, headers }`. `ofetch` throws on non-2xx.

```ts
import { clientRequest } from 'gpApi/typed-request'

const { data: poll } = await clientRequest('GET /v1/polls/:pollId', {
  pollId,
})
```

## Legacy (deprecated)

- `clientFetch` — `gpApi/clientFetch.ts`
- `serverFetch` — `gpApi/serverFetch.ts`
- `gpFetch` — `gpApi/gpFetch.ts`
- Routes live in `gpApi/routes.ts` as `{ path, method }` records.
- Returns polymorphic `T | Response | false` — callers must check `ok`/`status` and never rely on a thrown error.

## For unauthenticated endpoints

- `unAuthFetch` — `gpApi/unAuthFetch.ts`. Use for public endpoints that should reach gp-api with no credentials. `clientRequest` and `serverRequest` always attach auth (cookie / Bearer token), so swapping a public call to the typed helpers silently changes server-side behavior. Keep using `unAuthFetch` for anonymous calls.

## Auth

- Cookie-based JWT. `clientRequest` sets `credentials: 'include'`. `serverRequest` reads `getServerToken()` and adds `Authorization: Bearer …`.
- The current organization slug (when impersonating) is read from the `goodparty-org-slug` cookie and forwarded as the `x-organization` header.
- **A 401 from `clientRequest` means the tab no longer has a session** (Clerk ended it, or it expired), not that the call was wrong: gp-api answers 401 on a route that needs a session only when the request carried none, and the `/api` rewrite mints the Bearer from that session. `clientRequest` therefore sends the user to `/login?redirect_url=<current path>` once per page load (`gpApi/unauthorized.ts`) and still throws, and react-query does not retry a 401. Before this, one dead session failed every query on a page — 76 requests across 14 endpoints from one page load (ENG-11674). A 401 is also not reported through `reportClientError`: it is a signed-out state, not a defect.

## Testing

Use the typed mocker — it is keyed off `APIEndpoints` so mocks stay in sync with the contract.

```ts
import { api } from 'helpers/test-utils/api-mocking'

api.mock('GET /v1/polls', {
  status: 200,
  data: { results: [], pagination: { nextCursor: undefined } },
})
```

See `helpers/test-utils/api-mocking.ts` for `mockOrdered`, dynamic handlers, and request-aware mocks.

## See also

- `gpApi/CLAUDE.md` — repo-local guide for working in `gpApi/`.
- `.claude/skills/add-typed-endpoint.md` — recipe for adding a new endpoint.
- `.claude/skills/migrate-legacy-fetch.md` — recipe for porting a legacy call.
