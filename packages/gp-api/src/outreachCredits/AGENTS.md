# Outreach credits

The campaign's `outreachCreditCents` balance, spent per send. Each channel (P2P text, email, robocall) bills differently, so `OutreachCreditsService` owns the balance math and the channels only call it. Design: Per-campaign pricing TDD (ClickUp doc `2ky4jq2q-20493`, section 4).

## API

| Call                                                 | Does                                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `reserve(tx, campaignId, outreachId, estimateCents)` | In the caller's transaction: locks the campaign row, takes `min(balance, estimate)` off the balance, stamps `Outreach.creditReservedCents` |
| `settle(outreachId, actualCostCents, tx?)`           | `used = min(reserved, actual)`; returns `{ creditUsedCents, cardCents }`; gives `reserved - used` back to the balance                      |
| `release(outreachId, tx?)`                           | Gives the whole reserve back                                                                                                               |

`settle` and `release` open their own transaction unless the caller passes `tx`.

## Invariants: do not break these

- **The decrement is conditional** (`WHERE outreach_credit_cents >= r`). The row lock serializes sends; the DB CHECK is the last backstop.
- **`creditSettledAt` is the once-only claim.** `settle` and `release` stamp it with `WHERE credit_settled_at IS NULL`, so a second call, or a release after a settle, moves no money. A repeat `settle` still returns the amounts, worked out from the persisted reserve. `release` zeroes the reserve, so a later `settle` bills the card in full and a later `reserve` returns 0.
- **A returned remainder is dropped when `planEndedAt` is set.** Credit never resurrects after the plan ends, and `reserve` returns 0 for an ended plan.
- **`reserve` is idempotent:** a send that already holds a reserve (or is settled) gets its persisted amount back.
- **No ledger table.** Purchase rows and the per-send reservation are the audit.

## P2P text callers (behind `win_per_campaign_pricing`)

- **Immediate charge:** `calculateAmount` takes `min(balance, estimate)` off like free texts (remainder under 50c forgiven to $0). `executePostPurchase` calls `reserve` before `recordHold`, so no capture can run first.
- **Hold:** the hold stays at the full amount (ADR `2026-10-19-sms-hold-stays-undiscounted`). Capture charges `actual - reserved` and `settle`s in the same transaction as the `captured` commit; a send the credit covers settles captured at $0.
- **Unwind:** `OutreachP2pSmsFreeTextsService.restore` and the non-hold cancel in `OutreachService` call `release`.
- A campaign still holding the free-texts offer keeps that path and reserves no credit. Serve SMS never reserves.
