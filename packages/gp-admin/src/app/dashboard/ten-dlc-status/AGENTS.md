# ten-dlc-status — staff 10DLC triage page

Live view of every campaign stuck somewhere in 10DLC compliance. Same data as
the nightly report: the server action calls
`client.campaigns.getTenDlcStatusSnapshot()`, which hits gp-api's
`collectStatusSnapshot` in
`packages/gp-api/src/campaigns/tcrCompliance/services/nightly10DlcReport.service.ts`.
The snapshot shape is `TenDlcStatusSnapshot` in `@goodparty_org/contracts`
(`src/campaigns/TenDlcStatusSnapshot.schema.ts`). Change bucket populations
there, not here — this page only renders.

## Files

- `bucketMeta.ts` — per-bucket label/tone/hint. Tone drives the badge color
  AND the stuck count: red + amber count as stuck, gray (candidate nudge)
  never does; the page must keep matching the nightly report's "N stuck".
- `actions.ts` — the one server action; Clerk `READ_CAMPAIGNS` gate.
- `components/TenDlcStatusPage.tsx` + `BucketSection.tsx` +
  `SummaryDashboard.tsx` — rendering only.

## Triaging a bucket (field-tested recipes)

- **Domain not resolving** — rows here are NOT all registry holds. Always
  `whois <domain>` first and branch on the EPP status:
  - `serverHold` → Radix registry suspension (automated false positive on
    the vote-for-X-nov-2026 pattern). File at
    https://abuse.radix.website/unsuspension (JS stepper: lookup, then the
    `<span>Click here</span>` inside the result listitem opens the form;
    Name/Email/Reason + accuracy checkbox). Radix drops requests silently —
    if still held ~5 days after filing, re-file; escalate to
    abuse@radix.support citing the filing dates. Never re-purchase or
    re-kickoff: the Peerly CV already cites the URL.
  - `clientHold` → registrar expiry hold: domains are bought with Vercel
    auto-renew OFF, so they lapse 1 year after purchase. Within the grace
    period, renew via Vercel registrar API
    (`POST /v1/registrar/domains/{d}/renew` with years + expectedPrice +
    contactInformation, then poll the async order), then flip auto-renew
    with `PATCH /v3/domains/{d}` `{op: 'update', renew: true}` — the v1
    registrar PATCH silently no-ops. Months past expiry
    (redemptionPeriod) the API refuses; that takes a Vercel support ticket.
  - Local resolvers can lie under the GoodParty VPN — verify DNS with
    `dig @8.8.8.8`.
- **Rejected / stuck submission with a CV hold** — the row actions here
  (CV override, resend PIN) call real gp-api admin endpoints; a SQL
  filing-url swap alone never clears a CV hold, always override after a
  swap.
- **Amber buckets** (CV IN_REVIEW, waiting_to_finalize) — already escalated
  to Peerly by the weekday 11am job; silence from that job means the claims
  were consumed, not that it is broken.
