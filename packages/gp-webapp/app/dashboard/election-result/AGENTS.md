# Election result

`/dashboard/election-result`: what a candidate sees once their election date
has passed and `details.wonGeneral` is not saved. `DashboardLayout` sends them
here.

| Answer | Pro                                                                                               | Without Pro                                                           |
| ------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Won    | Congratulations (A2); its button creates the office unfinished, then Serve onboarding             | `wonGeneral: true`, then congratulations with the community card (N1) |
| Lost   | `wonGeneral: false`, then `loss/`: thank you, the community card, and the subscription alert (A4) | Same, without the alert (N2)                                          |

The Pro win creates the office before saving `wonGeneral`, pinned to the
`campaign-<id>` org header so gp-api links `campaignId` and copies the
campaign's position. It sends the campaign's party (mapped to Serve's values)
and `onboardingStep: 'confirm'`, and no term dates or `onboardingCompletedAt`:
Serve onboarding asks for the term and its pledge finishes the office. See
`app/serve/onboarding/AGENTS.md` ("Pro winners") for how the dashboard brings
an unfinished winner back.

Copy lives in `electionResultCopy.ts`. The Pro congratulations names the
place (`useServePlace`), the district population (rounded, dropped when
unknown) and the campaign's first custom issue (a generic line without one).
It never says "civic panel". The "Who gets the mic" video in the design has
no hosted source yet, so the screen ships without it. Confetti is the Pro
upgrade's `ConfettiField`, hidden under reduced motion.

`dismissal.ts` lets an impersonating admin leave the question, and the Serve
handoff, without answering (sessionStorage, cleared at every impersonation
boundary). `ActiveProSubscriptionAlert` is the only route to the billing
portal while this gate blocks the dashboard.
