# ADR-0001: No application-level auth in election-api

## Status

Accepted

## Context

`election-api` is an **internal** service. Its only callers are `gp-api` and
other internal services running inside the same VPC; it is never exposed to
public/end-user traffic. Network-level controls are the security boundary:

- VPC placement and security groups (defined in `deploy/components/`) restrict
  who can reach the service at the network layer.
- CORS is intentionally open (`origin: '*'`) because callers are internal.

The data served is **public** election/candidate information (places, races,
positions, candidacies, districts). The single field that qualifies as PII —
candidate `email` — is omitted at the query layer on the GET candidacy/race
read paths (per **CWE-306: Missing Authentication for Critical Function**, the
mitigation is to not surface sensitive data rather than to sit it behind an
unenforced guard).

A security audit re-flagged the absence of an application-level authentication
guard. This ADR records that the omission is **deliberate**, so the divergence
is not repeatedly re-flagged. Adding a guard now would be a breaking
cross-service change: all three `gp-api` clients call election-api without an
`Authorization` header, so introducing an enforced guard would break every
existing caller and provides no security benefit over the existing network
isolation for a public-data, internal-only service.

## Decision

`election-api` will **not** implement application-level authentication
(no JWT, no service-to-service auth guard). **Network isolation (VPC + security
groups) is the boundary.** Sensitive fields continue to be omitted at the query
layer rather than gated behind an unenforced guard.

## Contrast with people-api

Sibling service `people-api` **does** enforce a global `S2SAuthGuard`. That is
justified and correct there because `people-api` serves 200M+ L2 voter records
containing voter-level PII; an application-level guard is a necessary defense in
depth for that data class. `election-api` serves only public
election/candidate data and therefore does not carry the same requirement. The
two services intentionally diverge on this point.

## Consequences

- No per-request identity or authorization is available inside election-api;
  all access control is delegated to the network layer.
- New endpoints must not assume any caller identity, and must not surface
  voter-level or otherwise sensitive PII.
- Any change that would expose election-api outside the VPC, or that would begin
  serving voter-level PII, invalidates the assumption behind this decision (see
  "Revisit if").
- `AllExceptionsFilter` returning real error messages remains acceptable because
  the API is internal-only.

## Revisit if

Adopt the `people-api` service-to-service auth pattern (a global
`S2SAuthGuard`) if **either** of the following becomes true:

- election-api is ever exposed to traffic originating outside the VPC, or
- election-api begins serving voter-level PII (or any non-public data class).

## Known follow-up

`POST /v1/campaign-strategy-context` currently returns candidate `email` in its
response, whereas the GET candidacy/race read paths deliberately omit it. This
is an inconsistency worth resolving for parity — either omit `email` from the
campaign-strategy-context response as well, or explicitly document why that one
path is allowed to return it. Tracked here as a known follow-up, not addressed
by this ADR.
