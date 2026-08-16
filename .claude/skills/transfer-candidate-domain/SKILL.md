---
name: transfer-candidate-domain
description: Use when a candidate asks to take ownership of the custom domain GoodParty bought for them — "domain transfer request", "transfer PIN", "auth code", "EPP code", "release my website", "move my domain to GoDaddy/Namecheap/Cloudflare". Covers verifying the requester owns the domain, checking the 60-day ICANN transfer lock, retrieving the authorization code from Vercel (Owners-only dashboard path or the registrar API), the account-to-account Vercel alternative, and verifying the transfer completed. Registrar is Name.com via the Vercel reseller — NOT Route 53.
---

# Release a candidate's domain to them

GoodParty buys candidates' custom domains with GoodParty's own money and contact
details, so the candidate never had a registrar account. When they want the domain,
someone here has to hand it over. This skill is the fulfilment procedure.

There are two destinations, and they are not interchangeable — ask which one the
candidate actually wants before you start:

| Path                                                | What it is                                 | Lock-gated?             | Registrar ends up         |
| --------------------------------------------------- | ------------------------------------------ | ----------------------- | ------------------------- |
| **A — their own registrar** (GoDaddy, Namecheap, …) | Real inter-registrar transfer via EPP code | Yes, 60-day ICANN lock  | Wherever they chose       |
| **B — their own Vercel account**                    | Account-to-account move inside Vercel      | Shouldn't be — unproven | Still Name.com via Vercel |

Path A is what people usually mean by "transfer my domain". Path B is the escape
hatch when they're still inside the lock window or they just want control.

**Path B has never been run here.** Nobody has confirmed that Vercel permits moving
a registrar-purchased domain to an account outside the team, or that the move
itself doesn't trip a lock. Offer it as something to try, never as a promise, and
read the Path B section in full before you commit a candidate to it.

## Before you touch anything

**Read the loud warnings at the bottom of this file first.** Two of the mistakes
available here are irreversible and take a live campaign site down or push the
candidate's transfer out by two months.

## Access you need

You must be an **Owner** of the GoodParty Vercel team for the dashboard path —
Vercel only shows the "Transfer out" menu item to Team Owners. Check the current
Owner roster in Vercel → Settings → Members rather than assuming; membership
changes. If you're on the team with a personal email as well as your GoodParty
one, log in as the **GoodParty** account — a Member-role session silently hides
the menu item and it reads like the feature doesn't exist.

The API path needs no dashboard login, just the prod Vercel token:

```bash
aws sso login --profile gp-admin
eval "$(aws --profile gp-admin configure export-credentials --format env)"
unset AWS_PROFILE && export AWS_REGION=us-west-2

SECRET_JSON=$(aws secretsmanager get-secret-value --secret-id GP_API_PROD \
  --region us-west-2 --query SecretString --output text)
VT=$(python3 -c "import json,sys;print(json.load(sys.stdin)['VERCEL_TOKEN'])" <<<"$SECRET_JSON")
TEAM=$(python3 -c "import json,sys;print(json.load(sys.stdin)['VERCEL_TEAM_ID'])" <<<"$SECRET_JSON")

curl -s -H "Authorization: Bearer $VT" https://api.vercel.com/v2/user | head -c 200
```

The prod token belongs to an Owner account, so it works for the registrar
endpoints. **Do not use `packages/gp-api/.env`'s `VERCEL_TOKEN`** — that local dev
token 403s on every registrar endpoint.

Looking the domain up in the prod DB needs the GoodParty VPN:

```bash
eval "$(echo "$SECRET_JSON" | python3 -c 'import json,sys,urllib.parse;d=json.load(sys.stdin);pw=urllib.parse.quote(d["DB_PASSWORD"],safe="");print(f"export PROD_DATABASE_URL=\"postgresql://gpuser:{pw}@gp-api-db-prod.cluster-cmb1uukjsfbe.us-west-2.rds.amazonaws.com:5432/gpdb?sslmode=require\"")')"
psql "$PROD_DATABASE_URL"
```

If you only have the candidate's name or email and not the domain, the DB query in
Step 0 is how you find it.

## Don't go to Route 53

Some older docs claim domain registration runs through AWS Route 53. **They are
stale and will waste your time.** Registration moved to the Vercel registrar in
July 2025; what survives in `AwsRoute53Service` is only availability, suggestion,
and pricing lookups. Confirm for yourself if you like — Route 53 Domains is
us-east-1 only, so the region override is required:

```bash
aws route53domains list-domains --region us-east-1 --max-items 100
```

You will find no candidate domains there. Every candidate domain is registered at
**Name.com, Inc.** (IANA 625) with **Vercel as the reseller** in front of it. Drive
everything through Vercel, never Name.com directly.

## Step 0 — Verify the requester owns the domain

The auth code is a bearer credential for taking a domain. Anyone holding it can
move the domain. Confirm identity before you send it.

The domain string comes from a support ticket, so don't paste it into the query
body. Bind it to a psql variable and reference it with `:'domain'`, which psql
quote-escapes for you:

```sql
\set domain 'example.com'

SELECT d.id, d.name, d.status, d.source, d.created_at,
       (d.created_at + interval '60 days') AS eligible_at,
       w.status AS site_status, u.id AS user_id, u.email, u.first_name, u.last_name
FROM domain d
JOIN website w  ON w.id = d.website_id
JOIN campaign c ON c.id = w.campaign_id
JOIN "user" u   ON u.id = c.user_id
WHERE lower(d.name) = lower(:'domain');
```

**The email in a forwarded support ticket is not proof.** Candidates routinely sign
up with one address and email support from another, and the two differ by a dot or
a plus-tag often enough that you will hit it. If the request email doesn't match
`u.email` exactly, either confirm with the requester through the account email or
just **send the code to the address on file** and let them retrieve it there. Don't
resolve the mismatch by deciding it's probably the same person.

The HubSpot intake form exists specifically to bind the request to the account
email. If a request arrives as a raw support email instead, that verification never
happened — do it here.

## Step 1 — Confirm eligibility (the 60-day ICANN lock)

A gTLD cannot change registrars within 60 days of initial registration or of a
previous transfer. Compute the boundary from the **registration timestamp**, not
from a date someone typed into a ticket. It's a wall-clock instant, and being a day
early burns the candidate's day.

Three independent sources, which should agree:

```bash
# 1. Public WHOIS — the registry's own record
whois <domain> | grep -iE "Creation Date|Registrar:|Domain Status|Name Server"

# 2. Vercel — boughtAt is epoch milliseconds
curl -s -H "Authorization: Bearer $VT" \
  "https://api.vercel.com/v5/domains/<domain>?teamId=$TEAM" | python3 -m json.tool

# 3. Our DB — domain.created_at, from the Step 0 query
```

**The authoritative check is the auth-code endpoint itself**, which returns HTTP
409 with the unlock date if the lock is still on. That makes Step 2 both the
eligibility test and the retrieval in one call — you cannot accidentally hand out a
code for a locked domain.

## Step 2 (Path A) — Retrieve the authorization code

Two equivalent ways to get the same code.

### Method 1 — Vercel dashboard

1. Log in to Vercel as your **GoodParty Owner** account.
2. Switch scope to the GoodParty team.
3. Sidebar → **Domains**.
4. Find the domain; confirm the Registrar column says Vercel and age > 60 days.
5. Triple-dot (⋯) menu on that row → **Transfer out**.
6. The modal shows the **authorization code**. Copy it exactly.

If the modal spins forever and never produces a code, that's a known Vercel bug —
fall back to Method 2, and if that also fails, open a Vercel support ticket (their
fix has been to reset the code manually).

### Method 2 — Vercel registrar API

```bash
curl -s -w "\nHTTP %{http_code}\n" -H "Authorization: Bearer $VT" \
  "https://api.vercel.com/v1/registrar/domains/<domain>/auth-code?teamId=$TEAM"
```

`GET /v1/registrar/domains/{domain}/auth-code` → `200 {"authCode": "..."}`.

| HTTP    | code                                        | Means                                                                   |
| ------- | ------------------------------------------- | ----------------------------------------------------------------------- |
| 400     | `domain_not_registered`                     | Not registered through Vercel — wrong system, check the WHOIS registrar |
| 401     | `unauthorized`                              | Token bad or expired                                                    |
| 403     | `not_authorized_for_scope` / `forbidden`    | Token isn't scoped to the team, or isn't an Owner's                     |
| 404     | `domain_not_found`                          | Typo, or the domain already transferred out                             |
| **409** | **`domain_cannot_be_transfered_out_until`** | **Still inside the 60-day lock; the message carries the date**          |
| 429     | `too_many_requests`                         | Back off; `retryAfter` is in the body                                   |

**Fetch once.** It's a `GET`, but Vercel support describes "resetting" auth codes,
so treat every call as potentially rotating the value — re-fetching to
double-check may invalidate a code you already sent.

## Step 3 — The registrar lock is not yours to clear

WHOIS will show `Domain Status: clientTransferProhibited`. That is normal. Per
Vercel's docs: _"Use this authorization code with your new registrar... There is no
additional confirmation that you need to do on the Vercel side."_ There is no
unlock toggle in the dashboard and no transfer-lock endpoint in the SDK (only
`auto-renew` and `nameservers` PATCHes).

Older internal write-ups open Path A with "unlock the domain in Vercel". **No such
control exists.** Don't go hunting for it; its absence is not a sign you're in the
wrong place. Retrieving the auth code is the whole of our side of the job.

**Most likely place this stalls:** whether Name.com actually lifts
`clientTransferProhibited` when the gaining registrar submits the request. If the
candidate's new registrar reports "domain is locked", that is not fixable in the
Vercel UI — open a Vercel support ticket referencing the domain and the pending
transfer. Warn the candidate up front so a lock error doesn't read as GoodParty
stonewalling.

Two things you can usually rule out as blockers, but check:

```bash
curl -s -H "Authorization: Bearer $VT" \
  "https://api.vercel.com/v1/registrar/domains/<domain>/contact-verification?teamId=$TEAM"
# want {"verified": true} — otherwise there's an ICANN contact-verification hold

whois <domain> | grep -i dnssec
# unsigned means no DS records to strip before transfer
```

## Path B — move the domain to the candidate's own Vercel account

An account-to-account move inside Vercel rather than a registrar transfer. The
candidate needs only a free Vercel account.

**It is not an inter-registrar transfer, so ICANN's 60-day lock should not apply.**
That makes it the answer for someone still inside their lock window.

1. Ask the candidate for their Vercel account email and their account/team **slug**
   (their Settings → General).
2. Log in as your GoodParty Owner account, scope to the GoodParty team, sidebar →
   **Domains**.
3. Context menu next to the domain → **Move**.
4. Type their slug — the picker only lists teams _you_ belong to, so an outside
   account won't autocomplete.
5. Confirm. It takes effect immediately.

State the trade-offs before they choose:

- The registration **stays at Name.com under Vercel's reseller umbrella**. They
  control and pay for it in their own Vercel account, but they are not at a
  registrar of their own choosing. If they specifically asked for
  GoDaddy/Namecheap/Cloudflare, they want Path A.
- Renewal billing becomes theirs immediately.
- **Verify the site survives.** Vercel's docs say project domains remain attached
  on a move, but custom aliases that aren't project domains are removed
  immediately. Run `curl -sI https://<domain>` right after the move rather than
  assuming.

**Unproven:** whether Vercel permits moving a registrar-purchased domain to an
account outside the team, and whether the move itself trips a lock. Treat Path B as
promising, not guaranteed, and don't promise it to a candidate as a sure thing.

## Step 4 — What to send the candidate

Send to **`<u.email — the value the Step 0 query returned>`**, not an address from
a forwarded ticket, and not whichever address is most recent in the thread. Include the DNS warnings — they're what stop the site and their campaign
email from silently dying.

> Your domain **`<domain>`** is now eligible to transfer, and here is the
> authorization code (also called the EPP or transfer code) you'll need:
>
> **`<AUTH CODE>`**
>
> To move it: create an account at the registrar you want (Cloudflare, Namecheap,
> GoDaddy, etc.), choose "transfer a domain in", and enter `<domain>` and the code
> above. Transfers are governed by ICANN and typically take up to 7 days. You'll be
> responsible for the renewal fee at your new registrar from then on — the domain
> is currently paid through **`<expiry date>`**.
>
> Two things to know so nothing breaks:
>
> 1. **Your current website keeps working during and after the transfer**, as long
>    as you leave the nameservers set to `ns1.vercel-dns.com` /
>    `ns2.vercel-dns.com`. The moment you point the nameservers somewhere else,
>    `<domain>` stops showing your GoodParty site — so only do that once your new
>    site is actually ready.
> 2. **If you have email forwarding on this domain**, changing nameservers means
>    recreating those MX records at your new DNS host or campaign email will
>    bounce. Check the current zone before you switch.
>
> If your new registrar tells you the domain is locked, reply here and we'll
> escalate — that step is on the registrar's side, not something you can change.

Check the live DNS zone before sending, so warning 2 is accurate for this domain:

```bash
curl -s -H "Authorization: Bearer $VT" \
  "https://api.vercel.com/v4/domains/<domain>/records?teamId=$TEAM" | python3 -m json.tool
```

Also grab the expiry from `GET /v5/domains/<domain>?teamId=$TEAM` (`expiresAt`,
epoch ms) rather than guessing a year from purchase.

## Risky and irreversible — read before touching anything

**LOUD: never change the registrant contact to "fix" an email-routing problem.**
Under ICANN's Change of Registrant policy, changing the registrant name or email
starts a **fresh 60-day inter-registrar transfer lock**. There is no undo, and it
pushes the candidate's transfer out by two months. If mail routing is the problem,
solve it on the mailbox side.

**LOUD: do not remove the domain from the Vercel project, and do not delete the DNS
zone.** Candidate sites are live and their elections are real dates. Detaching the
domain or deleting the zone takes the site down. **Transferring the registration
out does not require touching either one.** If you find yourself in the project's
Domains settings, you are in the wrong place.

Lower-risk but worth knowing:

- Check `renew` on the domain before doing anything clever. Don't "helpfully"
  toggle `PATCH /v1/registrar/domains/{domain}/auto-renew`.
- Handing out the auth code is irreversible in the sense that you cannot un-tell
  someone a secret. Step 0 first.
- WHOIS privacy is on (registrant shows as Name.com's privacy service). Leave it;
  there's no Vercel API surface for it anyway.

## Step 5 — Verify the transfer completed

Transfers take up to ~7 days, so this is a check-back, not a same-day
confirmation. The best signal is public WHOIS showing a different registrar:

```bash
whois <domain> | grep -iE "Registrar:|Domain Status|Name Server|Updated Date"
```

- **Done** when `Registrar:` is no longer `Name.com, Inc.` It will re-lock with
  `clientTransferProhibited` at the new registrar — that's expected, not a failure.
- Vercel side: `GET /v5/domains/<domain>?teamId=$TEAM` — `transferredAt` flips from
  `null`, and the domain eventually drops out of the team's registrar list.
- Site continuity: `curl -sI https://<domain>` should stay 200 throughout, and
  `dig +short <domain> NS` should still show the Vercel nameservers until _they_
  change it.

If you took Path B, the check is different: the WHOIS registrar stays
`Name.com, Inc.` because nothing changed at the registry. Verify instead that
`GET /v5/domains/<domain>?teamId=$TEAM` 404s for our team, the domain is gone from
our Domains list, and `curl -sI` still returns 200.

**Our DB does not track any of this.** `domain.status` has no terminal
`transferred` state, and domains that left us still read `submitted` in prod. There
is no system of record for transfers — don't trust our DB to tell you whether one
happened.

## Known gaps in the process

Worth raising rather than working around silently, if you hit them:

- **Every retrieval needs Vercel team-Owner access.** There is no admin endpoint,
  no gp-admin screen, and no DB record, so support has to route through an engineer
  every time.
- **The registrant contact is hardcoded** to a single GoodParty mailbox in
  `packages/gp-api/src/vendors/vercel/vercel.const.ts`
  (`DOMAIN_REGISTRANT_CONTACT`), applied to every domain regardless of source. It
  was chosen to dodge ICANN verification emails; the cost is that the gaining
  registrar's Form of Authorization lands in that one inbox. Usually this only
  slows things down — the losing registrar has 5 days and the registry auto-
  approves on silence — but a registrar that demands an explicit click will stall
  indefinitely. Two other GoodParty mailboxes have historically received registrar
  mail (`sites@` and `candidate-domains@`); establishing who owns them is the
  cheap unblock. **Do not fix this by editing the registrant contact.**
- **Intake notifications from the HubSpot form route to one person**, so nobody
  else can see the backlog. There is no transfer-request table and no ticket queue.
- **Several docs still claim registration goes through Route 53.** They've been
  stale since July 2025.
