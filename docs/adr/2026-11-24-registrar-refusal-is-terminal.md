---
title: A registrar refusal is a terminal 409, suppressed for 15 minutes per name
status: active
decided_by: [agent]
date: 2026-11-24
code: ['#4053']
scope:
  - packages/gp-api/src/websites/services/domains.service.ts
  - packages/gp-api/src/websites/domains.types.ts
  - packages/gp-api/prisma/schema/domain.prisma
  - packages/gp-api/deploy/components/alerts.ts
supersedes: []
superseded_by:
---

# A registrar refusal is a terminal 409, suppressed for 15 minutes per name

## Decision

When the registrar fails an order with a terminal code (`payment-failed` today,
listed in `TERMINAL_REGISTRAR_ORDER_CODES`), `completeDomainRegistration`
answers 409 with `errorCode: DOMAIN_REGISTRAR_ORDER_REJECTED`, the registrar
code, the order id and `retryable: false`, on both the agent reservation path
and the paid checkout path. The refused order id is persisted on the domain row
with `registrarRefusalCode` and `registrarRefusedAt`, and a repeat call for the
same name within 15 minutes answers the same 409 without placing an order.
Every path that places a new order, and every order that completes, clears
those two fields. A failed order with any other code, or with none, stays a
retryable 502 exactly as before, because it cannot be told apart from a
transient fault and re-driving a failed order is a supported flow.

The 409 is not a route error, so a dedicated alert rule
(`win-domain-registrar-order-rejected`) pages on the one log line the refusal
writes.

## Context

On 2026-11-24 the charge to GoodParty's own Vercel team payment method was
declined and Vercel failed the resulting order with `payment-failed`. gp-api
reported that as a 502, which reads as "try again", and one campaign placed
three orders for one name in 47 seconds and a fourth eleven minutes later
(ENG-11775). The Failing order was already a verdict the caller acted on
wrongly, and the route alert paged it as a gp-api gateway fault rather than as
the billing problem it was. Any purchase by any campaign fails the same way
while the charge is declined, which is why the log line is paged at all.

## Alternatives rejected

- **Suppress unbounded (a permanent refusal per name).** The cause is a payment
  method on our own account that a person fixes; a permanent block would need a
  database edit before the campaign's next attempt could work. Fifteen minutes
  absorbs a retry loop and still lets the next attempt after the fix buy.
- **Suppress across names, or per campaign.** `payment-failed` is account-wide,
  so this would be the more truthful blast radius, but the registrar code names
  a cause for one order and the incident's retries were for one name. Blocking
  a campaign's purchase of a different available name on it costs a sale; the
  alert already reports the account-wide condition, so suppression does not
  have to.
- **Keep the 502 and rely on the route alert.** That is the reporting shape that
  caused the incident: a caller-safe-looking retry signal and a page that names
  a gateway fault instead of a billing one.
- **Report every failed order as terminal.** It breaks the supported re-drive of
  a failed order (`pending_domain_purchase`), which the E2E suite pins.

## Revisit if

The registrar's order error codes are documented well enough to classify every
one of them, or a refusal becomes a contract worth blocking on account-wide.
