# Win email flow

The Win email stepper, opened at `/dashboard/outreach/email` behind the `win-email-outreach` flag (UI-only; gp-api's routes are not gated). Backend: `packages/gp-api/src/emailOutreach/AGENTS.md`. The hub card arrives with the Serve surface; until then the route is the only way in.

## Key files

| Path                      | Purpose                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `EmailFlow.tsx`           | Step state and the shell. Order: goal, compose, audience, schedule, review                        |
| `emailSurface.ts`         | `EmailSurface`: every string that names the people. Win is `WIN_EMAIL_SURFACE`; Serve adds its own |
| `emailFlow.util.ts`       | Compose validation, draft payload, schedule check, upload summary, warming cap ladder             |
| `emailApi.ts`             | Typed calls to `/v1/outreach/email/*`                                                             |
| `EmailComingSoon.tsx`     | Placeholder for a feature whose backend has not shipped                                           |
| `EmailPreview.tsx`        | Approximate preview from the theme's color roles                                                  |

## Gotchas

- Compose comes before audience because the recipient upload needs a saved draft, and a draft needs a subject and body.
- `POST /v1/outreach/email` is a full replace. The flow re-sends every field on each save.
- The audience step is a stopgap (CSV test upload) until shared lists land. It is one component, `EmailAudienceStep`, so it swaps out cleanly.
- The warming cap on the audience and review steps is the TDD ladder indexed by `sender.warmingStep`. gp-api freezes the real cap at confirm.
- Placeholders are found by `data-testid="email-coming-soon-<feature>"`: `ai-draft`, `image`, `test-send`, `price`, `pay`, `status`. Replace the usage when its backend merges.
