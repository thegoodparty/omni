# Email outreach

Candidates (Win) and elected officials (Serve) email their opted-in contacts through Amazon SES. Until the shared contact lists land, a small test upload writes recipients straight onto a send. Design: TDD "2026-10-26 | Email outreach channel v1" (ClickUp doc `2ky4jq2q-20493`, page `2ky4jq2q-157273`); step lists, infrastructure and testing are on its Implementation Notes page (`2ky4jq2q-157293`). Payment goes through `src/paymentHolds/` (see its AGENTS.md).

Under construction: the module currently holds only the queue entry points, which return `false` until each workstream replaces them.

## Key files

| Path                                                            | Purpose                                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `prisma/schema/outreachEmail*.prisma`, `emailSweepLease.prisma` | The sender, send, recipient, suppression, reply and sweep-lease models                                       |
| `services/emailOutreachQueue.service.ts`                        | Handlers for the two queue messages, called from `queueConsumer.service.ts`                                  |
| `src/queue/queue.types.ts`                                      | `EMAIL_SEND_PREPARE`, `EMAIL_INBOUND` and their Zod schemas                                                  |
| `@goodparty_org/contracts` `EmailTemplate.const.ts`             | `EMAIL_LAYOUTS` and `EMAIL_THEMES`, the registries `OutreachEmail.layout` and `.theme` are validated against |
| `@goodparty_org/contracts` `SampleSizing.const.ts`              | `PRICE_PER_EMAIL_TENTH_CENTS`, `EMAIL_MIN_CHARGE_CENTS`                                                      |

## Invariants: do not break these

- **One sender at a time.** Only the holder of the `email_sweep_lease` row sends; the lease is the global SES rate limit. Don't swap it for a `CronLockService` minute claim, whose 30-second stale window is shorter than a sweep tick.
- **Recipients are claimed with `FOR UPDATE SKIP LOCKED`** (raw SQL, since Prisma `updateMany` has no limit). Duplicate-send exposure rests on this claim.
- **A send starts only when its hold is `held`,** re-checked against Stripe through `PaymentHoldsService.getHold`. Every capture goes through `settle`; email implements the settlement adapter and never captures itself.
- **The warming cap (`recipientCap`) is frozen at confirm** and never raised.
- **The shared SQS queue is never reconfigured** (encryption, deduplication or new producers). Replies arrive by SNS at `POST /v1/email/webhooks/sns`, which enqueues them like any other producer. Other systems send to this queue too.
- **Per-email SES events never go through the queue.** Bounce, complaint and send counts come from SES's CloudWatch metrics, tagged per send. If delivery, open or click data is ever needed, add a configuration-set event destination to Firehose and S3; one message per email would back up every other job on the queue.
- **Each organization sends as its own SES tenant** (`OutreachEmailSender.sesTenantName`), so SES pauses one organization instead of the account. Every send passes `TenantName`.
- **Bounces and complaints are suppressed by SES's account suppression list,** not our table. `OutreachEmailSuppression` holds only unsubscribes.
- **Previews and tests never call real SES.** `VENDOR_CRONS_ENABLED` is true wherever vendors are mocked, so SES must be a mocked vendor. Dev sends only to allowlisted addresses and the SES mailbox simulator.
- **Suppressions are scoped by `organizationSlug`.** Office sends also honor the campaign's organization, through `ElectedOffice.campaignId`. Unsubscribe tokens carry the email and organization, never only a row id.
- **Theme keys are never edited in place.** Sends store only the key, so a changed theme gets a new key.
- **Copy is mode-keyed** (`docs/product-vocabulary.md`): voters and a campaign on Win, constituents and an office on Serve.

## Gotchas

- `src/scheduled-messaging/` and `EmailService` (Mailgun) are transactional email. Don't build outreach on them.
- Which address bounced isn't tracked per message. SES's `ListSuppressedDestinations` keeps every hard bounce and complaint with its date, so they can be matched back to recipient rows later.
