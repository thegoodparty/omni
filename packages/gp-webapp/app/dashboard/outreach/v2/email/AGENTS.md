# Win email flow

The email stepper. Win opens at `/dashboard/outreach/email` behind `win-email-outreach`; the Win hub's Email tile navigates there. Serve mounts `EmailFlow` with `SERVE_EMAIL_SURFACE` from the Serve hub's Email card, behind `serve-email-outreach`. Both flags are UI-only; gp-api's routes are not gated. Backend: `packages/gp-api/src/emailOutreach/AGENTS.md`.

## Key files

| Path                      | Purpose                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `EmailFlow.tsx`           | Step state and the shell. Order: goal, compose, audience, schedule, review                        |
| `emailSurface.ts`         | `EmailSurface`: every string that names the people, plus `isServe`. `WIN_EMAIL_SURFACE` and `SERVE_EMAIL_SURFACE` |
| `emailFlow.util.ts`       | Compose validation, draft payload, schedule check, upload summary, warming cap ladder             |
| `emailApi.ts`             | Typed calls to `/v1/outreach/email/*`, or `/v1/outreach/serve/email/*` when `surface.isServe`                                                             |
| `EmailComingSoon.tsx`     | Placeholder for a feature whose backend has not shipped                                           |
| `EmailPreview.tsx`        | Approximate preview from the theme's color roles                                                  |
| `app/dev/email-templates` | Dev-only gallery of every layout and theme through `EmailPreview`; its Playwright test attaches screenshots |

## Gotchas

- Compose comes before audience because the recipient upload needs a saved draft, and a draft needs a subject and body.
- `POST /v1/outreach/email` is a full replace. The flow re-sends every field on each save.
- The audience step is a stopgap (CSV test upload) until shared lists land. It is one component, `EmailAudienceStep`, so it swaps out cleanly.
- The warming cap on the audience and review steps is the TDD ladder indexed by `sender.warmingStep`. gp-api freezes the real cap at confirm.
- The AI draft, image upload and test send call C2's routes (`/draft`, `/images/presign`, `/:id/test`). The image goes straight to S3 with the presigned form fields, and the saved `imageUrl` must be the returned `publicUrl`; gp-api rejects any other URL. The test send needs the saved draft id, so it lives on the review step.
- Placeholders are found by `data-testid="email-coming-soon-<feature>"`: `price`, `pay`, `status`. Replace the usage when its backend merges.
