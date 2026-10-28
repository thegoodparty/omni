# Election result

`/dashboard/election-result`: what a candidate sees once their election date
has passed and `details.wonGeneral` is not saved. `DashboardLayout` sends them
here.

| Answer | Pro                                                         | Without Pro                     |
| ------ | ----------------------------------------------------------- | ------------------------------- |
| Won    | Office created unfinished, then Serve onboarding            | `wonGeneral: true` only         |
| Lost   | `wonGeneral: false`, then `loss/`                           | Same                            |

The Pro win creates the office before saving `wonGeneral`, pinned to the
`campaign-<id>` org header so gp-api links `campaignId` and copies the
campaign's position. It sends the campaign's party (mapped to Serve's values)
and `onboardingStep: 'confirm'`, and no term dates or `onboardingCompletedAt`:
Serve onboarding asks for the term and its pledge finishes the office. See
`app/serve/onboarding/AGENTS.md` ("Pro winners") for how the dashboard brings
an unfinished winner back.

`dismissal.ts` lets an impersonating admin leave the question, and the Serve
handoff, without answering (sessionStorage, cleared at every impersonation
boundary). `ActiveProSubscriptionAlert` is the only route to the billing
portal while this gate blocks the dashboard.
