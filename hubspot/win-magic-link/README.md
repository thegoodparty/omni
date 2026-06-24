# Win Magic Link — HubSpot App Card (Internal)

> **Internal testing tool, not production.** A HubSpot UI-extension App Card on
> the Contact record that lets a salesperson send a candidate ("Win")
> onboarding magic link directly from the record.

The card calls a serverless **app function** that holds the gp-api M2M bearer
token as a HubSpot secret and hits the admin endpoint:

```
POST /v1/admin/campaign/magic-link
{ email, firstName, lastName }
```

gp-api provisions a passwordless Clerk user, mints a sign-in token, and returns
the `/win/welcome?__clerk_ticket=...` redemption URL. Unlike the Serve
(elected-official) variant, it deliberately does **not** create an
`ElectedOffice` — a lead with no elected office and no campaign is routed by the
webapp into the candidate onboarding flow (`/onboarding/office-selection`),
where they pick their office and their campaign is created. **The browser card
never sees the M2M token** — only the server-side function does.

## Emailing the link

After gp-api returns the URL, the function emails it to the contact via
HubSpot's **Single-Send transactional API**:

```
POST https://api.hubapi.com/marketing/v3/transactional/single-email/send
Authorization: Bearer <HUBSPOT_TRANSACTIONAL_TOKEN>
{
  emailId: <WIN_MAGIC_LINK_EMAIL_ID>,
  message: { to: <email>, sendId: "win-magic-<userId>-<timestamp>" },
  contactProperties: { firstname, lastname },
  customProperties: { magic_link_url: <url> }
}
```

The email is authored in HubSpot (a Transactional-type email whose CTA links to
`{{ custom.magic_link_url }}`). The send is **best-effort and non-fatal**: if the
secrets are missing or HubSpot rejects the send, the function still returns the
`url` (with `sent: false` and a `sendError`) so the rep can copy it manually. The
card always shows the copyable link as a fallback. This requires two secrets,
`HUBSPOT_TRANSACTIONAL_TOKEN` and `WIN_MAGIC_LINK_EMAIL_ID` (see setup below).

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
    win-magic-link-card-hsmeta.json              # card definition (type "card", objectTypes ["CONTACT"])
    WinMagicLinkCard.tsx                          # React card UI, registers via hubspot.extend()
    package.json                                  # @hubspot/ui-extensions + react + typescript
  functions/
    win-magic-link-function-hsmeta.json          # app-function config + secretKeys (gp-api + HubSpot transactional)
    sendMagicLink.js                              # server-side; calls gp-api, then emails the link via single-send
    package.json                                  # no external deps (Node 18 global fetch)
```

## Required contact properties

The card forwards `email`, `firstname`, and `lastname`. No BallotReady person id
is needed for the candidate flow (there is nothing to pre-fill — the candidate
picks their own office during onboarding).

## Deploy

Requires the HubSpot CLI **v8.4.0+** and access to the GoodParty developer
account (Enterprise to install an app with serverless functions; a developer
test account works for testing).

```bash
npm install -g @hubspot/cli@latest      # v8.4.0+ required
hs --version                            # confirm >= 8.4.0
hs account auth                         # auth against the GoodParty developer account

# from this directory (omni/hubspot/win-magic-link/):
hs project install-deps                 # install card + function package.json deps
hs secret add GP_API_M2M_TOKEN          # paste the gp-api M2M bearer (never commit it)
hs secret add HUBSPOT_TRANSACTIONAL_TOKEN  # paste the private-app token (pat-...) for single-send
hs secret add WIN_MAGIC_LINK_EMAIL_ID   # paste the transactional email's ID
hs project upload                       # build + deploy
```

See **HubSpot email setup** below for how to create the transactional email and
private-app token that those two secrets reference.

Optionally override the gp-api base (defaults to `https://gp-api.goodparty.org`)
by adding `GP_API_URL` as a secret AND adding it to `secretKeys` in
`functions/win-magic-link-function-hsmeta.json` (2026.03 functions only
receive env vars via secrets).

After upload, install the private app (Development → Projects → your project →
the app's UID → Distribution → Install), then add the card to the contact record
page via the record **Customize** flow (Settings → Objects → Contacts → Record
customization → add the card from the Card library, searching for its `uid`
`win_magic_link_card`).

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
   page → that is `WIN_MAGIC_LINK_EMAIL_ID`.
2. **Create a private-app token.** Settings → Integrations → Private Apps →
   create an app with the `transactional-email` scope; copy its access token
   (`pat-...`) → that is `HUBSPOT_TRANSACTIONAL_TOKEN`. (You can reuse the same
   private-app token as the Serve project if it already has the scope.)
3. **Add the secrets** (from this directory, `omni/hubspot/win-magic-link/`):
   - `hs secret add HUBSPOT_TRANSACTIONAL_TOKEN` (paste the `pat-...` token)
   - `hs secret add WIN_MAGIC_LINK_EMAIL_ID` (paste the email ID)
   Both are already listed in `secretKeys` in
   `functions/win-magic-link-function-hsmeta.json`.
4. **Deploy:** `hs project upload`.

If either secret is missing or HubSpot rejects the send, the function still
returns the link (`sent: false` + a `sendError`) and the card surfaces a warning
with the copyable link, so the rep can always send it manually.

## Clerk dashboard configuration (one-time, manual)

These live in the Clerk dashboard, not in code, and are shared with the Serve
flow (no Win-specific changes needed if Serve is already configured):

1. **Email verification code (OTP):** Enable the `email_code` first factor
   (User & Authentication → Email, Phone, Username → Email verification code).
   This powers passwordless return-login on the shared `/login` page (Clerk's
   prebuilt `<SignIn>` surfaces the email-code option automatically).
2. **Sign-in tokens:** No dashboard toggle — `signInTokens.createSignInToken`
   (used by the magic-link endpoint) works with the standard backend API key.
3. **Allowed redirect / origin:** Ensure the app origin that serves
   `/win/welcome` is in Clerk's allowed origins (same origin as `/serve/welcome`,
   so already covered).

## Notes

- The serverless function is the only place the M2M token exists; the browser
  card never sees it.
- gp-api is allowlisted in `app-hsmeta.json` `permittedUrls.fetch`. If the
  function's outbound request to gp-api is ever blocked, confirm that entry.
- This is a separate project from `serve-magic-link/`. The two share the same
  gp-api M2M token and (optionally) the same transactional private-app token, but
  use different endpoints (`/admin/campaign/magic-link` vs
  `/admin/elected-office/magic-link`), redemption pages (`/win/welcome` vs
  `/serve/welcome`), and transactional emails.
