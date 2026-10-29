# Win email flow

The email stepper. Win opens at `/dashboard/outreach/email` behind `win-email-outreach`; the Win hub's Email tile navigates there. Serve mounts `EmailFlow` with `SERVE_EMAIL_SURFACE` from the Serve hub's Email card, behind `serve-email-outreach`. Both flags are UI-only; gp-api's routes are not gated. Backend: `packages/gp-api/src/emailOutreach/AGENTS.md`.

## Key files

| Path                      | Purpose                                                                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EmailFlow.tsx`           | Step state and the shell. Order: goal, compose, audience, schedule, review, pay; after payment it shows `EmailStatus`                                                   |
| `emailSurface.ts`         | `EmailSurface`: every string that names the people, plus `isServe`. `WIN_EMAIL_SURFACE` and `SERVE_EMAIL_SURFACE`                                                       |
| `emailFlow.util.ts`       | Compose validation, draft payload, schedule check, upload summary, warming cap ladder                                                                                   |
| `emailApi.ts`             | Typed calls to `/v1/outreach/email/*`, or `/v1/outreach/serve/email/*` when `surface.isServe`                                                                           |
| `EmailPayStep.tsx`        | `PaymentHoldCard` with `savePaymentMethod` calling `POST /:id/confirm`; the price comes from the send's `estimate`                                                      |
| `EmailStatus.tsx`         | Scheduled, Sending X of Y, Paused, Sent, Canceled; update card on `pending_payment`; cancel. Win also mounts it at `/dashboard/outreach/email/[id]` (`EmailStatusPage`) |
| `EmailPreview.tsx`        | Approximate preview from the theme's color roles                                                                                                                        |
| `app/dev/email-templates` | Dev-only gallery of every layout and theme through `EmailPreview`; its Playwright test attaches screenshots                                                             |

## Gotchas

- Compose comes before audience because the recipient upload needs a saved draft, and a draft needs a subject and body.
- `POST /v1/outreach/email` is a full replace. The flow re-sends every field on each save.
- The audience step is a stopgap (CSV test upload) until shared lists land. It is one component, `EmailAudienceStep`, so it swaps out cleanly.
- The warming cap on the audience and review steps is the TDD ladder indexed by `sender.warmingStep`. gp-api freezes the real cap at confirm.
- The AI draft, image upload and test send call C2's routes (`/draft`, `/images/presign`, `/:id/test`). The image goes straight to S3 with the presigned form fields, and the saved `imageUrl` must be the returned `publicUrl`; gp-api rejects any other URL. The test send needs the saved draft id, so it lives on the review step.
- A card declined at confirm answers 402 (`EmailConfirmDeclined`) and the send stays a draft. `EmailPayStep` turns that into the card component's decline state, and every retry goes through confirm again (the component keeps using `savePaymentMethod`), never the hold's card route, which refuses a draft. Back stays offered after a decline, since nothing left draft.
- A `pending_payment` send (a placement still resolving) takes a new card on `EmailStatus` through the hold's route, then confirm with `card-on-file` moves it to `pending`.
- The public unsubscribe and forward-confirm pages live in `app/email/` and are in the middleware's public-route list. Their GET loads state only; the button POSTs.
