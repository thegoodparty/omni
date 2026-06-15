# Slice 4 — Support estimate

Small, self-contained backend slice. Buildable now behind an interim value; the real
data source is external (data + research).

## Goal

Serve the dashboard hero number ("N of M constituents likely support you") behind a
stable interface, reading a data + research-owned table when it lands.

## Package(s)

`packages/gp-api`, `packages/contracts`.

## Design

- Data + research own a table (analogous to the Win number) keyed on
  `electedOfficeId`, holding the estimate and its components. **gp-api does not
  compute the number.**
- `SupportEstimateService` reads that table and returns
  `{ likelySupport, districtSize, percentOfDistrict, trendVsLastMonth }`.
- Until the table exists, return an **interim hard-coded value** behind the same
  interface, clearly marked, so the frontend and contract are unblocked. Swapping to
  the real table later is an internal change only.

## Endpoint

`@UseElectedOffice()` + `@ReqElectedOffice()`:

- `GET /v1/dashboard/support-estimate` → the estimate for the office.

## Contracts

`packages/contracts/src/dashboard/SupportEstimate.schema.ts`: the response DTO.
Rebuild. (Lives under `dashboard/` alongside slice 2's card schema — different file,
no conflict.)

## Acceptance criteria

- Endpoint returns the typed shape for the office.
- Interim value is isolated behind the service; a TODO marks the table swap.

## Tests (vitest)

- Service returns the interim shape.
- Controller: `@UseElectedOffice` wiring (happy + missing header → 404).

## External dependency

Support-estimate table keyed on `electedOfficeId` — data + research (Bryan). Confirm
the exact table name, key, and columns when it lands, then replace the interim value.

## Standing rules

Contracts in `packages/contracts`; `@UseElectedOffice`/`@ReqElectedOffice`;
`npm run verify` green.
