# Architecture principles

Read this before you plan, build or change product code: a page, an endpoint, a
job, a query or a data model. Each principle is here because breaking it cost us.
They are defaults. If your change has to depart from one, say which one and why in
the PR body.

## 1. Pages fetch their data in the browser

gp-webapp is a single-page app. A page that waits on gp-api while the server
renders it shows the user nothing until the slowest call returns, and when gp-api
is slow, every such page hangs with it.

- Render the page at once and fetch from gp-api in a client component with React
  Query (`docs/state-management.md` in gp-webapp), even for a cheap call.
- The server render may still check access, redirect, and set metadata.
- Pages that await `serverRequest` for their data, such as
  `app/dashboard/priorities/[priorityId]/page.tsx`, predate this. Don't copy them.

## 2. Heavy computation stays off the request path

Node runs every request a gp-api task serves on one thread. Work that grows with
its input (a model fit, a loop over a district's people or tracts, parsing a large
file) blocks every other request on that task until it finishes. On 2026-11-04 one
read took 4 to 9 minutes on a statewide district and froze every prod server.

- Compute it when the inputs change and store the result, or run it in a queue
  job. Requests read the stored result.
- If it must run inside a request, cap the input and refuse anything above the cap.
- Size it for the largest input the product allows (a statewide district, the
  biggest state), not the fixture you tested with. Ship a test that runs that size
  and fails past a time limit.

## 3. Don't cache by default

A cache is a second copy of the truth that goes stale on its own schedule, and it
usually hides a slow read that should be fixed instead. gp-api also runs 4 to 24
tasks, and the load balancer sends each request to whichever task is least busy,
so a cache held in one task's memory rarely gets a hit and every task holds its
own copy.

- Make the slow thing fast: fix the query, add the index, batch the calls.
- If a result is expensive and read often, compute it when its inputs change and
  store it in Postgres (principle 2).
- No in-memory caches in gp-api and no cache services such as Redis. Caching the
  framework already does for us, such as Next.js's built-in caching, is fine.

## Keeping this file useful

- A principle earns a place only from evidence: an incident, or the same review
  correction made more than once. Name the evidence in it.
- Keep it short enough to read in a minute. Edit or delete a principle in place
  when it stops being true; don't add exceptions to it.
- A principle states a rule and why. Specific numbers belong in the code and its
  tests.
