# app/(dashboard)/priorities/

The Serve Priorities tab: where an elected official holds what they want to get
done this term, and where they open one to work it forward. Gated by
`serveAccess()` and by the `serve-priorities` flag.

## Files

| File                             | Role                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `layout.tsx`                     | The flag gate for the whole segment. Flag off redirects to Chief of Staff                             |
| `page.tsx`                       | The list. Priorities are required; the issue feed is best-effort so a feed miss cannot blank the page |
| `components/PrioritiesHub.tsx`   | The list: lane chips, rows, archive, and the community-issue seed lane below                          |
| `components/AddPriorityForm.tsx` | Inline create, opened by the header button                                                            |
| `data/priorities-api.ts`         | Create, update, archive, and prioritize-an-issue, all through `gpApi/typed-request`                   |

`[priorityId]/` is the detail view and carries its own doc.

## The flag

`serve-priorities`, wrapped in `@shared/experiments/servePrioritiesFlag`. Two
readers, and they have to stay together:

- `layout.tsx` resolves it server-side (`getFlagVariants`) so a flag-off user is
  redirected before the priorities and community-issues reads below ever run.
- `DashboardMenu.tsx` reads the hook with `trackExposure=false` and passes the
  result into `getDashboardMenuItems`, which is where the nav item is inserted.
  The page is the treatment surface; the sidebar item is not.

Removing the flag means deleting the layout, the wrapper hook, and the third
argument to `getDashboardMenuItems`.

## The row

Each row is one priority, and it carries four things in this order: rank, what
it is, what to do next, and where it has got to.

- **Rank is display order of what the API returns.** `Priority` has no `rank`
  column, so there is no reorder control; the first three rows carry the top-N
  marker, and only when no lane filter is on.
- **`nextAction` renders under the title when it is there, and nothing renders
  when it is not.** A row with no next action reads as a row with no next
  action. A stand-in line ("No next action yet") is a row of furniture on every
  priority the agent has not reached yet, and it trains the eye to skip the one
  line on the page worth reading.
- **The step badge comes from `PRIORITY_STEP_LABELS`**, never a local copy of
  the seven names. `currentStep` arrives as a plain string, so it is narrowed
  against `PRIORITY_STEP_IDS` rather than indexed blind: an id this build does
  not know reads as nothing. `currentStep: null` means every step is settled,
  and the badge reads **Plan ready**. The last of the seven steps is "The
  plan", so that is what finishing means, and "Settled" is already the name of
  a per-step state in the rail.
- **Archive is per row and takes one click.** gp-api soft-archives, so the
  record survives; the row leaves the list.

## Lane names are Serve names

`PrioritySource.win_import` is a position the official carried over from when
they ran. The lane reads **From your platform**, not "From your campaign": a
sitting official has an office and a term, and no campaign
(`docs/product-vocabulary.md`). The chips and the row badges both read from
`SOURCE_META`, so a lane cannot be named two ways.

## Chrome comes from Ordinances

This feature deliberately wears the ordinance list's clothes so the two Serve
workflows feel like one product: a header with a caption and a pill CTA on the
right, a row of tally chips, then one bordered card of `divide-y` rows, with a
secondary seed section below. The chips tally lanes (`PrioritySource`) where
ordinances tally statuses.

## Adding it to the nav is four edits, not one

`shared/DashboardMenu.tsx` (the item and its flag argument),
`NAV_LABELS`/`NAV_HEADER_ICONS` in `shared/navLabels.ts`, `MOBILE_PAGE_TITLES`
in `shared/DashboardLayout.tsx`, and `SERVE_ROUTE_PREFIXES` in
`shared/serveRoutes.ts`. The route prefix is what makes the post-auth org
switch land a user back here instead of on the Chief of Staff home. The
directory is also listed in `scripts/serveVocabulary.ts` `SERVE_ONLY_DIRS`, so
every string in here is checked as Serve copy.
