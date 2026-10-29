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
- Home also leads its card deck with `campaign-manager/ElectionResultHomeCard.tsx`
  while the question is open, so it survives closing the chat: the question,
  "Your election was on {day}. Tell me how it went so I can help with what's
  next." (`HOME_CARD_COPY`), and I won, I didn't win, Results aren't final
  yet in place of the task buttons. On the next-task Home, `NextTaskCard`
  (`surface="manager"`) draws it in front of the tasks with the task layers
  behind and an `electionResult` headline; the plan never shows it. The
  legacy Home puts it first in `CampaignManagerTasks`. It reads the chat
  hook's state through the chat context, so it only appears where that chat
  mounts, and its three answers are the chat's handlers, except "I didn't
  win" routes to `loss/` as the page does.
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
Serve onboarding asks for the term and its pledge finishes the office. A
winner who already holds another office still gets a new one for this seat;
asking again returns the office linked to this campaign. See
`app/serve/onboarding/AGENTS.md` ("Pro winners") for how the dashboard brings
an unfinished winner back.

Copy lives in `electionResultCopy.ts`. The Pro win (`PrepareToServe.tsx`)
is two steps. First a full-screen celebration: "Congratulations, you won!",
the office name, confetti, a progress bar and Continue; it moves on by itself
after 3 seconds (reduced motion stills the bar and hides the confetti, but
still moves on). Then the A2 card: "Get ready to serve {place}"
(`useServePlace`) and "Serving starts with staying connected to {place}.",
then two columns from `md` up (stacked below): the "Who gets the mic" video
on the left; on the right three points, each an icon, a bold title and one
muted line, and a footnote about the chief of staff's meeting briefings. The
first point names the district population (rounded, dropped when unknown);
the third names the campaign's first issue (`issueInSentence`: the
lowest-`order` campaign position's `topIssue.name` from
`GET /v1/campaigns/:id/positions`, title-case words lowercased, generic
without one). Custom issue titles are not used: they are free text that
does not read cleanly mid-sentence. The one button sits right-aligned under
a border, pinned to the bottom on a phone. Focus moves to the heading. It
never says "civic panel".

The video is served from `public/videos/`: the landscape cut from `md` up and
the square one below, as two native `<video>`s toggled by responsive classes,
each with controls, no autoplay, `preload="metadata"` and a textless poster
of the podium (a crop of the 0:02 frame). A visually hidden paragraph carries
the video's own lines as its description; those lines name the civic panel,
the page's copy does not. The winner without Pro (`CongratulationsStep.tsx`)
gets no video. Confetti is the Pro upgrade's `ConfettiField`, hidden under
reduced motion.

`dismissal.ts` lets an impersonating admin leave the question, and the Serve
handoff, without answering (sessionStorage, cleared at every impersonation
boundary). `ActiveProSubscriptionAlert` is the only route to the billing
portal while this gate blocks the dashboard.
