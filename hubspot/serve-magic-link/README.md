# Serve Magic Link — HubSpot App Card

> A HubSpot UI-extension App Card on the Contact record that lets a salesperson
> send an elected-official (EO) onboarding magic link directly from the record.

The card calls a serverless **app function** that holds the gp-api M2M bearer
token as a HubSpot secret and hits the admin endpoint:

```
POST /v1/admin/elected-office/magic-link
{ email, firstName, lastName, personId? }
```

gp-api provisions a passwordless Clerk user, mints a sign-in token, optionally
pre-fills the `ElectedOffice` from BallotReady (when the contact has a
`br_person_id`), and returns the `/serve/welcome?__clerk_ticket=...` redemption
URL. **The browser card never sees the M2M token** — only the server-side
function does.

## Emailing the link

After gp-api returns the URL, the function emails it to the contact via
HubSpot's **Single-Send transactional API**:

```
POST https://api.hubapi.com/marketing/v3/transactional/single-email/send
Authorization: Bearer <HUBSPOT_TRANSACTIONAL_TOKEN>
{
  emailId: <MAGIC_LINK_EMAIL_ID>,
  message: { to: <email>, sendId: "eo-magic-<userId>-<timestamp>" },
  contactProperties: { firstname, lastname },
  customProperties: { magic_link_url: <url> }
}
```

The email is authored in HubSpot (a Transactional-type email whose CTA links to
`{{ custom.magic_link_url }}`). The send is **best-effort and non-fatal**: if the
secrets are missing or HubSpot rejects the send, the function still returns the
`url` (with `sent: false` and a `sendError`) so the rep can copy it manually. The
card always shows the copyable link as a fallback. This requires two secrets,
`HUBSPOT_TRANSACTIONAL_TOKEN` and `MAGIC_LINK_EMAIL_ID` (see setup below).

## Texting the link

Reps are usually on a call when they send a link, so the card can text it as well
as email it. Two buttons drive this:

- **Generate & text link** — mints a link and texts it in the same call, by
  passing `phone` / `smsConsent` / `consentSource` through to
  `POST /v1/admin/elected-office/magic-link`.
- **Text link** — texts the lead's *current* link via
  `POST /v1/admin/elected-office/magic-link/sms`, for when they never received
  the email. This deliberately does not mint a new link: doing so would rotate
  the short-link slug and kill the one already in their inbox.

Both require the consent checkbox ("agreed on this call to be texted"), and both
prefer `mobilephone` over `phone` — a landline in `phone` accepts the send and
never delivers. Like email, the send is **best-effort and non-fatal**: the
response carries `smsSent` and an optional `smsError`, and the copyable link
remains as a fallback.

Two things are worth knowing about the design:

- **SMS is sent by gp-api via Sinch, not from this function.** The serve and win
  cards are two separate HubSpot projects, so sending here would mean two
  implementations and provider credentials duplicated into both. It also needs
  database access for the short link, which only gp-api has. No `secretKeys`
  change is therefore needed — the function still only talks to gp-api.
- **The texted link is a short link, not the redemption URL.** The ticketed URL
  measures ~743 characters (Clerk sign-in tokens are RS256 JWTs), which is five
  SMS segments and a query string carrier filters read as phishing. gp-api mints
  a 12-character slug and texts `https://app.goodparty.org/s/<slug>`, which the
  webapp resolves and forwards.

Consent is **enforced in gp-api, not by this checkbox**: it is recorded on the
`User` (so it outlives any single link), and a lead who has replied STOP is
refused regardless of what the card sends. The checkbox is the capture point,
not the control.

## Persistent lifecycle state on the card

The card shows the magic link's lifecycle and keeps it across card close/reopen.
gp-api is the source of truth (a `magic_link` row keyed to the lead) and
**mirrors** the derived status onto custom **contact properties**, which the
card reads (read-only) via `useCrmProperties`:

| Property | Type | Written when |
|---|---|---|
| `eo_magic_link_status` | single-line text | every transition (`sent` / `redeemed` / `onboarding_completed` / `expired`) |
| `eo_magic_link_sent_at` | date picker (datetime) | link sent |
| `eo_magic_link_expires_at` | date picker (datetime) | link sent |
| `eo_magic_link_redeemed_at` | date picker (datetime) | lead redeems the link |
| `eo_onboarding_completed_at` | date picker (datetime) | lead finishes serve onboarding |

### The redemption URL is never mirrored to HubSpot

The link carries a **live single-use Clerk sign-in ticket** — a bearer
credential. Mirroring it to a contact property would put that credential at rest
in the CRM, readable by any connected integration with contacts-read. So the URL
lives **only in gp-db**. When a rep needs to copy an active link, the card pulls
it on demand through the serverless function (which holds the M2M token) via
`GET /v1/admin/elected-office/magic-link?email=…` (action `fetch`). gp-api only
returns the URL while the link is still redeemable (`sent`); a redeemed, expired,
or completed link returns `url: null`, so a consumed token is never handed back
out. The card derives the `active` state from `eo_magic_link_sent_at` +
`eo_magic_link_expires_at` rather than the URL.

Lifecycle transitions are driven entirely by gp-api (not this app — it only has
`crm.objects.contacts.read`):

- **sent** — `POST /v1/admin/elected-office/magic-link` persists the row
  (including the URL) and mirrors `sent` + the timestamps (no URL).
- **redeemed** — the `/serve/welcome` redemption page pings
  `POST /v1/elected-office/magic-link/redeemed` (session-authed) after the lead
  activates their session; gp-api marks it redeemed and re-mirrors.
- **onboarding_completed** — gp-api hooks the authenticated write that sets
  `onboardingCompletedAt` on the elected office and re-mirrors.

gp-api writes these via its own private-app token (`HUBSPOT_TOKEN`, which already
has `crm.objects.contacts.write`), so **no extra scope is needed on this app**.
The `status` value is recomputed from the timestamps at read time (so an
unredeemed link flips to `expired` without any write), and the card re-derives
it client-side as well.

### One-time HubSpot setup (custom contact properties)

Create the five properties above on the **Contact** object (Settings → Properties
→ Contacts → Create property). Use a date-picker (date & time) type for the
`*_at` properties and single-line text for `eo_magic_link_status`. Group them
under e.g. "Elected Official Magic Link". No workflow is required — gp-api writes
them directly. (There is intentionally **no** `eo_magic_link_url` property — see
above.)

## Platform version

This is a developer **Project** targeting platform version **`2026.03`**
(GA March 30, 2026), which reintroduced serverless app functions to Projects.
We use a Project (not a legacy app) because legacy CRM cards sunset
Oct 31, 2026, and App Cards + serverless functions only exist within Projects.

## Layout

```
hsproject.json                                   # project descriptor, platformVersion 2026.03
src/app/
  app-hsmeta.json                                # app config: private dist, static auth, scopes, permittedUrls
  cards/
    serve-magic-link-card-hsmeta.json            # card definition (type "card", objectTypes ["CONTACT"])
    ServeMagicLinkCard.tsx                        # React card UI, registers via hubspot.extend()
    package.json                                  # @hubspot/ui-extensions + react + typescript
  functions/
    serve-magic-link-function-hsmeta.json        # app-function config + secretKeys (gp-api + HubSpot transactional)
    sendMagicLink.js                              # server-side; calls gp-api, then emails the link via single-send
    package.json                                  # no external deps (Node 18 global fetch)
```

### Schema notes (vs. the older 2025.x scaffold)

- App config is `app-hsmeta.json` (`type: "app"`), not `public-app.json`.
  `public: false` is now `distribution: "private"` + `auth.type: "static"`;
  scopes live under `auth.requiredScopes`.
- The card config is `*-hsmeta.json` with `type: "card"`, a top-level `uid`, a
  `config` block (`name`, `description`, `location`, `entrypoint`,
  `objectTypes`). `objectTypes` is a plain array (`["CONTACT"]`);
  `propertiesToSend` is no longer declared here — it is passed at call time in
  `hubspot.serverless(uid, { propertiesToSend })`.
- App functions are individual `*-hsmeta.json` files (`type: "app-function"`)
  in `functions/`, replacing the single `app.functions/serverless.json`.
  Secrets are listed under `config.secretKeys`.
- The function uses Node 18's global `fetch` (not `hubspot.fetch`, which is a
  frontend-only API), and returns `body` as an object (the card reads
  `result.body`).
- `app-hsmeta.json` allowlists `https://gp-api.goodparty.org`,
  `https://gp-api-dev.goodparty.org`, and `https://api.hubapi.com` under
  `permittedUrls.fetch` (the last is required for the single-send email call).

## Required contact property

The card forwards `email`, `firstname`, `lastname`, and `br_person_id`. Create a
custom contact property **`br_person_id`** (single-line text) holding the
contact's BallotReady person id to enable office/term pre-fill. Without it the
EO still onboards, just with nothing pre-filled.

## Deploy

Requires the HubSpot CLI **v8.4.0+** and access to the GoodParty developer
account (Enterprise to install an app with serverless functions; a developer
test account works for testing).

```bash
npm install -g @hubspot/cli@latest      # v8.4.0+ required
hs --version                            # confirm >= 8.4.0
hs account auth                         # auth against the GoodParty developer account

# from this directory (omni/hubspot/serve-magic-link/):
hs project install-deps                 # install card + function package.json deps
hs secret add GP_API_M2M_TOKEN          # paste the gp-api M2M bearer (never commit it)
hs secret add HUBSPOT_TRANSACTIONAL_TOKEN  # paste the private-app token (pat-...) for single-send
hs secret add MAGIC_LINK_EMAIL_ID       # paste the transactional email's ID
hs project upload                       # build + deploy
```

See **HubSpot email setup** below for how to create the transactional email and
private-app token that those two secrets reference.

Optionally override the gp-api base (defaults to `https://gp-api.goodparty.org`)
by adding `GP_API_URL` as a secret AND adding it to `secretKeys` in
`functions/serve-magic-link-function-hsmeta.json` (2026.03 functions only
receive env vars via secrets).

After upload, install the private app (Development → Projects → your project →
the app's UID → Distribution → Install), then add the card to the contact record
page via the record **Customize** flow (Settings → Objects → Contacts → Record
customization → add the card from the Card library, searching for its `uid`
`serve_magic_link_card`).

### Local development

`hs project dev` previews the card and streams `console.*` from the function to
your terminal. Note: changes to files under `functions/` require a fresh
`hs project upload` to take effect.

## HubSpot email setup (one-time, manual)

Auto-sending the link needs a transactional email and a private-app token. These
can't be done from code (the account must have the **Transactional Email**
add-on):

1. **Create the transactional email.** Marketing → Email → create a
   **Transactional**-type email. Add a greeting (e.g. `{{ contact.firstname }}`)
   and a **CTA button** whose link is `{{ custom.magic_link_url }}`. Also include
   a **plain-text fallback link** using the same `{{ custom.magic_link_url }}`
   token (in case the button doesn't render). Set the send method to **Through an
   API**, **publish**, then copy the **email ID** from the email's Performance
   page → that is `MAGIC_LINK_EMAIL_ID`.
2. **Create a private-app token.** Settings → Integrations → Private Apps →
   create an app with the `transactional-email` scope; copy its access token
   (`pat-...`) → that is `HUBSPOT_TRANSACTIONAL_TOKEN`.
3. **Add the secrets** (from this directory, `omni/hubspot/serve-magic-link/`):
   - `hs secret add HUBSPOT_TRANSACTIONAL_TOKEN` (paste the `pat-...` token)
   - `hs secret add MAGIC_LINK_EMAIL_ID` (paste the email ID)
   Both are already listed in `secretKeys` in
   `functions/serve-magic-link-function-hsmeta.json`.
4. **Deploy:** `hs project upload`.

If either secret is missing or HubSpot rejects the send, the function still
returns the link (`sent: false` + a `sendError`) and the card surfaces a warning
with the copyable link, so the rep can always send it manually.

## Clerk dashboard configuration (one-time, manual)

These live in the Clerk dashboard, not in code:

1. **Email verification code (OTP):** Enable the `email_code` first factor
   (User & Authentication → Email, Phone, Username → Email verification code).
   This powers passwordless return-login on the shared `/login` page (Clerk's
   prebuilt `<SignIn>` surfaces the email-code option automatically). It is
   instance-wide, so confirm the hosted sign-in still reads acceptably.
2. **Sign-in tokens:** No dashboard toggle — `signInTokens.createSignInToken`
   (used by the magic-link endpoint) works with the standard backend API key.
3. **Custom email templates:** Brand the OTP / verification emails from the
   GoodParty domain (Customization → Emails). Magic-link redemption uses the
   ticket strategy at `/serve/welcome`; the link itself is delivered by us
   (copied from this card or emailed), so no Clerk email template is required
   for it.
4. **Allowed redirect / origin:** Ensure the app origin that serves
   `/serve/welcome` is in Clerk's allowed origins.

## Notes

- The serverless function is the only place the M2M token exists; the browser
  card never sees it.
- gp-api is allowlisted in `app-hsmeta.json` `permittedUrls.fetch`. If the
  function's outbound request to gp-api is ever blocked, confirm that entry.
