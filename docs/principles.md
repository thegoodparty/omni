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

## 3. No caches in one task's memory

gp-api runs 4 to 24 tasks, and the load balancer sends each request to whichever
task is least busy. A cache held in one task's memory rarely gets a hit, and every
task holds its own copy that goes stale on its own schedule.

- Store computed results where every task reads them: Postgres, or S3 for large
  files.
- If something is slow enough to need a cache, make it faster or compute it ahead
  of time (principle 2).
- Per-process state that does not need to be shared, such as a rate limiter or
  static config, is fine.

## Keeping this file useful

- A principle earns a place only from evidence: an incident, or the same review
  correction made more than once. Name the evidence in it.
- Keep it short enough to read in a minute. Edit or delete a principle in place
  when it stops being true; don't add exceptions to it.
- A principle states a rule and why. Specific numbers belong in the code and its
  tests.
