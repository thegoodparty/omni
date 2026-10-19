---
title: A Win SMS hold stays undiscounted; the webapp shows the free texts off it from gp-api's isHold
status: active
decided_by: [dealvz]
date: 2026-10-19
code: ['#2946']
scope:
  - packages/gp-api/src/payments/services/purchase.service.ts
  - packages/gp-api/src/outreach/services/outreachPurchase.service.ts
  - packages/gp-webapp/app/dashboard/outreach/v2/sms/SmsReviewStep.tsx
supersedes: []
superseded_by:
---

# A Win SMS hold stays undiscounted; the webapp shows the free texts off it from gp-api's isHold

## Decision

A Win SMS hold-billing checkout keeps authorizing the undiscounted amount, and
capture keeps taking the free texts off. The review step shows the total after
the free texts and tells the candidate their bank may show a temporary hold of
the larger amount. It knows the session is a hold from `isHold` on the
`create-checkout-session` response, gp-api's own manual-capture decision, never
from the browser's read of the `win_sms_hold_billing` flag.

## Context

Candidates stopped at payment because the total ignored their free texts. The
charge was right; only the display was wrong. The hold amount is load-bearing:
`resolveWinSmsHoldAmount` persists the send cap as
`maxTextsForAmountInCents(holdAmount)`, and capture is clamped to the hold.
The free texts are redeemed in the payment webhook, after the hold exists, so
a send that loses the offer in a race needs the full amount.

## Alternatives rejected

- **Hold the discounted amount.** Would need the send cap to add the free
  texts back (as it does for promo codes), and leaves a send that loses the
  offer in a race short at capture. A billing change, not a display fix.
- **Have the webapp read the flag itself.** The browser and gp-api evaluate
  the flag independently and can disagree for a while; a wrong guess shows a
  total lower than the real charge.

## Revisit if

Candidates complain about the pending amount at their bank, or the free texts
start being redeemed before the hold is placed.
