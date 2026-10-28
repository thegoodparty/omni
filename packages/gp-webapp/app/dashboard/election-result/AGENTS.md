# Election result

`/dashboard/election-result`: what a candidate sees once their election date
has passed and `details.wonGeneral` is not saved. `DashboardLayout` sends them
here from every dashboard route except the campaign manager home
(`/dashboard`), where the manager's chat asks instead.

## Two places ask, the first answer wins

`electionResultQuestion.ts` (`isElectionResultPending`) is the one rule: from
the day after election day until `wonGeneral` is a boolean. Both the page (A1)
and the campaign manager chat (C1, `campaign-manager/useElectionResultChat.ts`)
ask while it holds; answering either saves `wonGeneral`, which closes both.

- The page asks "Did you win your race for {office}?" with I won, I didn't
  win this time, and Results aren't final yet.
- The chat opens itself on Home, once per visit, on a new chat whose opener
  is the question and whose starter chips are the answers. "I won" opens
  `/dashboard/election-result?result=won`, which skips the question
  (`startWithWin`). "I didn't win" saves the loss and swaps the opener for
  the thank you (C4) with the community as its one card. The candidate's
  answer is not echoed as a bubble: the opener is display-only.
- Home also shows `campaign-manager/ElectionResultHomeCard.tsx` (the free
  offer card's look) while the question is open, so it survives closing the
  chat. It reads the chat hook's state through the chat context, so it only
  appears where that chat mounts, and its three answers are the chat's
  handlers, except "I didn't win this time" routes to `loss/` as the page does.
- Results aren't final yet snoozes both for 3 days (`snoozeElectionResult`
  in `dismissal.ts`): localStorage, keyed to the campaign, the meet card's
  pattern. Test mode's Apply clears it with the impersonation dismissal.

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
It never says "civic panel". Beside the points (stacked above them on a
phone) is the "Who gets the mic" video, served from `public/videos/`: the
landscape cut from `md` up and the square one below, as two native
`<video>`s toggled by responsive classes, each with its poster JPG, controls,
no autoplay and `preload="metadata"`. A visually hidden paragraph carries the
video's own lines as its description; those lines name the civic panel, the
page's copy does not. The winner without Pro gets no video. Confetti is the
Pro upgrade's `ConfettiField`, hidden under reduced motion.

`dismissal.ts` lets an impersonating admin leave the question, and the Serve
handoff, without answering (sessionStorage, cleared at every impersonation
boundary). `ActiveProSubscriptionAlert` is the only route to the billing
portal while this gate blocks the dashboard.
