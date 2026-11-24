# State Management

Three layers, in order of "which to reach for first":

1. **Local component state** (`useState` / `useReducer`) — for ephemeral UI state (open/closed, draft input). Default for anything not shared across components.
2. **Server cache via React Query** — for anything fetched from gp-api. The `QueryClient` is configured in `app/shared/query-client.tsx` with a 5-minute stale time. Mutations should `invalidateQueries` on the relevant keys.
3. **React Context providers** — for cross-route state that doesn't fit a server cache: current user, current campaign, current organization, feature flags.

There is no Redux / Zustand / Jotai. Don't add one.

## Load gp-api data in the browser

**A page loads its gp-api data in the browser, with React Query, by
default.** The webapp is a single-page app: the shell renders at once, and
each section shows its own loading and error state while its data arrives.

A page's server render may call gp-api (`serverRequest`) only for what it
cannot render without:

- deciding access or a 404 (does this priority exist, is this user allowed);
- the few fields the shell itself needs (a title, a slug), from a cheap
  lookup of one record.

Never in the server render: a read that does real work (a warehouse query, a
model, an LLM call, a list of any size, anything slow on a large org), and
never something a single section shows. Those go in a client component that
calls `clientRequest` through `useQuery`.

Why: a page that waits on gp-api in its server render is only as fast as its
slowest call and fails whole when that call fails, and every reload or "Try
again" sends it again. On 2026-11-04 the priority page waited on its read in
the server render; the read was slow, and the reloads froze every gp-api
server (post-mortem "Statewide read freeze").

Reference implementations: the priority page fetches its read as the
workspace opens (`fetchPriorityReadStatus` in
`app/dashboard/priorities/[priorityId]/components/PriorityWorkspace.tsx`),
and the results page renders `PriorityResultsLoader`
(`app/dashboard/priorities/[priorityId]/results/components/PriorityResultsView.tsx`):
a spinner, then the view, or a one-line error, while the server page only
fetches the priority to 404 on.

`npm run check:server-fetch` counts the pages and layouts that call
`serverRequest` and fails above its baseline, so a new page cannot copy the
old pattern. Moving a page's data to the browser can add a client component;
that is the justified kind of raise the `'use client'` ratchet asks you to
note in the PR.

## App-wide providers

Mounted at the root in `app/layout.tsx` (or close to it). Order matters — children of a provider can read its context.

| Provider                  | File                                                   | Purpose                                                    |
| ------------------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| `UserProvider`            | `app/shared/user/UserProvider.tsx`                     | Auth state, loaded from cookie. Most app code starts here. |
| `ImpersonateUserProvider` | `app/shared/user/ImpersonateUserProvider.tsx`          | Impersonation state — drives the global banner.            |
| `CampaignProvider`        | `app/shared/hooks/CampaignProvider.tsx`                | Current campaign. Refreshes on user change.                |
| `CampaignStatusProvider`  | `app/shared/user/CampaignStatusProvider.tsx`           | Campaign-level status flag.                                |
| `FeatureFlagsProvider`    | `app/shared/experiments/FeatureFlagsProvider.tsx`      | Amplitude experiments — see `docs/feature-flags.md`.       |
| `QueryClientProvider`     | `app/shared/query-client.tsx`                          | React Query client.                                        |
| `Snackbar`                | `app/shared/utils/Snackbar.tsx`                        | App-wide toast surface. Use `helpers/useSnackbar.ts`.      |
| `NavigationProvider`      | `app/shared/layouts/navigation/NavigationProvider.tsx` | Sidebar / nav state.                                       |

## Feature-local providers

When state is bound to a single feature, wrap that feature — don't pollute the root tree. Examples:

- `app/dashboard/campaign-assistant/components/ChatProvider.tsx` — current chat thread + send action.
- `app/dashboard/outreach/hooks/OutreachContext.tsx` — selected outreach + audience filters.
- `app/shared/hooks/VoterContactsProvider.tsx` — voter-contact data; mounted by features that need it.

## Reading the user

```ts
import { useUser } from '@shared/hooks/useUser'

const [user, setUser, loading] = useUser()
// user:    User | null   (null until the cookie request resolves)
// setUser: (user?) => void
// loading: boolean       (true on first render — gate UI on this to avoid
//                         flashing the logged-out branch during hydration)
```

Server components: `helpers/userServerHelper.ts` (reads cookie via `next/headers`).

## React Query conventions

- Query keys follow `[entity, scope, params]` shape (e.g. `['campaign', campaignId, 'status']`). Keep them stable.
- 5-minute stale time is the default; override per query only with a reason.
- After mutations, invalidate the smallest affected key. Don't `invalidateQueries()` with no key — it nukes the whole cache, and a mutation only ever invalidated one entity's worth of it.
- The exception is a change of **scope** rather than of data. Switching organization (`organization-picker.tsx`) is one action that remounts and clears: everything under `OrganizationScope` (which both shells wrap their page content in) unmounts, and `removeQueries()` empties the cache for the org it left. The exhaustiveness is the point — a consumer that stays mounted would rebuild its own entry under the incoming org's header, which is how a departed row's `outreach-detail` 404'd (ENG-10991). Only two keys survive, and neither is org-scoped: `organizations` (a switch resolves against it — a caller that creates an org refreshes this list then selects the new slug, so it is the only copy that makes that slug resolvable) and `eligibility` (per-user, and it gates FollowOnFlow's wizard). Feature code therefore never clears its own cache on a switch, and never has to key on the org slug to be safe. Decision and why: `docs/adr/2026-11-23-switching-organization-remounts-and-clears-client-state.md`.

## When to add a new provider

- It's needed by ≥3 unrelated routes/features and isn't fetchable.
- It's intrinsically global (e.g. theme, auth).

If it's only used by one feature, keep it in that feature's dir. Adding a provider at `app/shared/` is a tree-wide change — confirm scope before doing it.

## Anti-patterns

- Don't store fetched server data in context — let React Query own it.
- Don't deep-relative-import providers (`../../../shared/user/UserProvider`). Use the `@shared/*` alias.
- Don't re-wrap an already-mounted provider inside a feature.
