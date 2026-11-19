# Outreach credits

The campaign's `outreachCreditCents` balance, spent per send. Each channel (P2P text, email, robocall) bills differently, so `OutreachCreditsService` owns the balance math and the channels only call it. Design: Per-campaign pricing TDD (ClickUp doc `2ky4jq2q-20493`, section 4).

## API

| Call                                                 | Does                                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `reserve(tx, campaignId, outreachId, estimateCents)` | In the caller's transaction: locks the campaign row, takes `min(balance, estimate)` off the balance, stamps `Outreach.creditReservedCents` |
| `settle(outreachId, actualCostCents, tx?)`           | `used = min(reserved, actual)`; returns `{ creditUsedCents, cardCents }`; gives `reserved - used` back to the balance                      |
| `release(outreachId, tx?)`                           | Gives the whole reserve back                                                                                                               |

`settle` and `release` open their own transaction unless the caller passes `tx`.

`reserveIfEnabled(campaignId, outreachId, estimateCents)` is what the channels call: it reads `win_per_campaign_pricing` for the campaign owner (0 when off, so a flag-off send bills the card in full) and reserves in its own transaction.

## Channels

- **Robocall** (`outreachRobocallHold`/`Capture`): the reserve is taken when the hold is placed, after any promo (promo first, then credit), so a send deferred past the window draws credit when the sweep places the hold. The hold is `estimate - promo - reserved`; a remainder under Stripe's 50-cent minimum, or none, takes the `promoCoversTotal` branch (no hold). Capture takes the authorized amount, then settles `captured + reserved`, so the reserve is fully used; a zero-connect run, a cancel, a `send_failed` and an expiry cancel `release`.
- **Email** (`outreachEmailConfirm`, `outreachEmailLifecycle`, `paymentHolds.completeSettle`): confirm reserves before `saveCardAndPlan` and holds `price - reserved`; a send credit covers has no hold row, so the lifecycle starts it on `creditReservedCents > 0` and settles it with `settle(outreachId, emailChargeCents(sentCount))` through the email settlement adapter, never `paymentHolds`. For a partly covered send `completeSettle` settles credit first and captures `min(actual - creditUsed, authorized)`; it engages only when the outreach row has a reserve. Cancel before send, a failed start and a failed prepare `release`.

## Invariants: do not break these

- **The decrement is conditional** (`WHERE outreach_credit_cents >= r`). The row lock serializes sends; the DB CHECK is the last backstop.
- **`creditSettledAt` is the once-only claim.** `settle` and `release` stamp it with `WHERE credit_settled_at IS NULL`, so a second call, or a release after a settle, moves no money. A repeat `settle` still returns the amounts, worked out from the persisted reserve. `release` zeroes the reserve, so a later `settle` bills the card in full and a later `reserve` returns 0.
- **A returned remainder is dropped when `planEndedAt` is set.** Credit never resurrects after the plan ends, and `reserve` returns 0 for an ended plan.
- **`reserve` is idempotent:** a send that already holds a reserve (or is settled) gets its persisted amount back.
- **No ledger table.** Purchase rows and the per-send reservation are the audit.
