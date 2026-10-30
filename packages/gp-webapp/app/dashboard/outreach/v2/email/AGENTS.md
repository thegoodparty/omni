# Win email flow

The email stepper. Win opens at `/dashboard/outreach/email` behind `win-email-outreach`; the Win hub's Email tile navigates there. Serve mounts `EmailFlow` with `SERVE_EMAIL_SURFACE` from the Serve hub's Email card, behind `serve-email-outreach`. Both flags are UI-only; gp-api's routes are not gated. Backend: `packages/gp-api/src/emailOutreach/AGENTS.md`.

## Key files

| Path                      | Purpose                                                                                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EmailFlow.tsx`           | Step state and the shell. Order: goal, compose, audience, schedule, review, pay; after payment it shows `EmailStatus`                                                                                                         |
| `emailSurface.ts`         | `EmailSurface`: every string that names the people, plus `isServe`. `WIN_EMAIL_SURFACE` and `SERVE_EMAIL_SURFACE`                                                                                                             |
| `emailFlow.util.ts`       | Compose validation, draft payload, schedule check, warming cap ladder                                                                                                                                                        |
| `EmailAudienceStep.tsx` | The shared voter-file picker (`OutreachAudienceStep` and `useOutreachAudience` with `reachabilityKey: 'email'` and a count-only `{ hasEmail: true }` builder overlay), then the consent box, the warming cap line ("1,000 of 4,800") and the empty state for a list with no one to email. Email has no recommended lists |
| `emailApi.ts`             | Typed calls to `/v1/outreach/email/*`, or `/v1/outreach/serve/email/*` when `surface.isServe`                                                                                                                                 |
| `EmailPayStep.tsx`        | `PaymentHoldCard` with `savePaymentMethod` calling `POST /:id/confirm`; the price comes from the send's `estimate`                                                                                                            |
| `EmailStatus.tsx`         | Scheduled, Sending X of Y, Paused, Sent (Sent to X of Y when stopped at the payment deadline), Canceled; update card on `pending_payment`; cancel. Win also mounts it at `/dashboard/outreach/email/[id]` (`EmailStatusPage`) |
| `EmailPreview.tsx`        | Approximate preview from the theme's color roles                                                                                                                                                                              |
| `app/dev/email-templates` | Dev-only gallery of every layout and theme through `EmailPreview`; its Playwright test attaches screenshots                                                                                                                   |

## Gotchas

- Compose comes before audience because a draft needs a subject and body, and the audience step saves the draft with its list.
- `POST /v1/outreach/email` is a full replace. The flow re-sends every field on each save.
- The audience step counts a list's people with an email address from the list detail's `email` reachability count. Only a Serve organization's imported contacts have emails, so a Win list reads 0: the step says no one in the list has an email address yet and Next stays off. Consent is tied to the list it was given for, so picking another list asks again.
- The warming cap on the audience step is the TDD ladder indexed by `sender.warmingStep`. The review step reads gp-api's `estimate` (`audienceCount`, `recipientCap`, `priceCents`), counted server-side; gp-api freezes the real cap at confirm.
- The AI draft, image upload and test send call C2's routes (`/draft`, `/images/presign`, `/:id/test`). The image goes straight to S3 with the presigned form fields, and the saved `imageUrl` must be the returned `publicUrl`; gp-api rejects any other URL. The test send needs the saved draft id, so it lives on the review step.
- A card declined at confirm answers 402 (`EmailConfirmDeclined`) and the send stays a draft. `EmailPayStep` turns that into the card component's decline state, and every retry goes through confirm again (the component keeps using `savePaymentMethod`), never the hold's card route, which refuses a draft. Back stays offered after a decline, since nothing left draft.
- A `pending_payment` send (a placement still resolving) takes a new card on `EmailStatus` through the hold's route, then confirm with `card-on-file` moves it to `pending`.
- The public unsubscribe and forward-confirm pages live in `app/email/` and are in the middleware's public-route list. Their GET loads state only; the button POSTs.
