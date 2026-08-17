// HubSpot app function (serverless), platform version 2026.03. Runs
// server-side inside HubSpot, so it is the only place the gp-api M2M bearer
// token lives — it is injected as the `GP_API_M2M_TOKEN` secret and is never
// exposed to the browser card.
//
// It forwards the contact's email / name to the gp-api admin endpoint, which
// provisions a passwordless Clerk user, mints a sign-in token, and returns the
// `/win/welcome?__clerk_ticket=...` redemption URL. Unlike the serve variant,
// it does NOT create an ElectedOffice — the lead lands in the candidate ("win")
// onboarding flow, where they pick their office and their campaign is created.
//
// Once gp-api returns the URL, the function emails it to the contact via
// HubSpot's Single-Send transactional API
// (`/marketing/v3/transactional/single-email/send`), authenticating with the
// `HUBSPOT_TRANSACTIONAL_TOKEN` private-app secret and the
// `WIN_MAGIC_LINK_EMAIL_ID` transactional email. The send is best-effort: if it
// (or its config) fails, we still return the `url` so the rep can copy it
// manually, alongside a `sent` boolean and an optional `sendError`.
//
// 2026.03 functions run on Node 18, so we use the built-in global `fetch`
// rather than `hubspot.fetch` (a frontend-only API) or an external HTTP client.
// The function is invoked from the card via `hubspot.serverless()`, so contact
// properties arrive on `context.propertiesToSend`. The returned `body` is an
// object (not a JSON string); the card reads `result.body`.
//
// Three actions are supported via `context.parameters.action`:
//   - 'generate' (default): provision the candidate, mint a new link, email it.
//     When `phone` is also supplied, gp-api texts the link in the same call and
//     the response carries `smsSent` / `smsError` alongside `sent` / `sendError`.
//   - 'fetch': return the lead's CURRENT redemption URL from gp-db without
//     minting a new one. The URL is never mirrored to HubSpot (it carries a
//     live sign-in ticket), so this is how the card retrieves it on demand for
//     the rep's "copy link" action. gp-api only returns a URL while the link is
//     still redeemable; a consumed/expired link comes back as { url: null }.
//   - 'sms': text the lead's CURRENT link without minting a new one, for when
//     the rep emailed it and the lead says it never arrived. Minting a fresh
//     link would rotate the short-link slug and kill the one already in the
//     lead's inbox.
//
// SMS itself is sent by gp-api via Sinch, not from here: the serve and win cards
// are two separate HubSpot projects, so building it here would mean two
// implementations and provider credentials duplicated into both.

const DEFAULT_GP_API_URL = 'https://gp-api.goodparty.org'
const SINGLE_SEND_URL =
  'https://api.hubapi.com/marketing/v3/transactional/single-email/send'

// Emails the magic link to the contact via the Single-Send transactional API.
// Best-effort: returns { sent, sendError? } and never throws.
async function sendMagicLinkEmail({ email, firstName, lastName, url, userId }) {
  const transactionalToken = process.env.HUBSPOT_TRANSACTIONAL_TOKEN
  const emailId = process.env.WIN_MAGIC_LINK_EMAIL_ID
  if (!transactionalToken || !emailId) {
    return {
      sent: false,
      sendError:
        'Email auto-send is not configured (HUBSPOT_TRANSACTIONAL_TOKEN and WIN_MAGIC_LINK_EMAIL_ID secrets are required).',
    }
  }

  try {
    const res = await fetch(SINGLE_SEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${transactionalToken}`,
      },
      body: JSON.stringify({
        emailId: Number(emailId),
        message: { to: email, sendId: `win-magic-${userId}-${Date.now()}` },
        contactProperties: { firstname: firstName, lastname: lastName },
        customProperties: { magic_link_url: url },
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      return {
        sent: false,
        sendError: `HubSpot single-send returned ${res.status}: ${text}`,
      }
    }

    return { sent: true }
  } catch (e) {
    return {
      sent: false,
      sendError: `Failed to reach HubSpot single-send API: ${e && e.message ? e.message : String(e)}`,
    }
  }
}

// Fetches the lead's current redemption URL from gp-db (read-only; never mints
// a new link). Returns { url, status } where url is null when the link is
// consumed, expired, or absent.
async function fetchExistingMagicLink({ gpApiUrl, token, email }) {
  try {
    const res = await fetch(
      `${gpApiUrl}/v1/admin/campaign/magic-link?email=${encodeURIComponent(email)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
    )

    const text = await res.text()
    if (!res.ok) {
      let message = `gp-api returned ${res.status}.`
      try {
        const parsed = JSON.parse(text)
        message =
          (typeof parsed.message === 'string' && parsed.message) ||
          (typeof parsed.error === 'string' && parsed.error) ||
          message
      } catch (_) {
        if (text) message = `${message} ${text}`
      }
      return { statusCode: res.status, body: { error: message } }
    }

    let data = {}
    try {
      data = JSON.parse(text)
    } catch (_) {
      return { statusCode: 502, body: { error: 'gp-api returned a non-JSON response.' } }
    }

    return {
      statusCode: 200,
      body: { url: data.url || null, status: data.status || null },
    }
  } catch (e) {
    return {
      statusCode: 502,
      body: { error: `Failed to reach gp-api: ${e && e.message ? e.message : String(e)}` },
    }
  }
}

// Texts the lead's current link via gp-api (which sends through Sinch). Used by
// the 'sms' action; consent is enforced server-side in gp-api, so passing
// smsConsent here is a claim to record, not the gate itself.
async function textExistingMagicLink({
  gpApiUrl,
  token,
  email,
  phone,
  smsConsent,
  consentSource,
}) {
  try {
    const res = await fetch(`${gpApiUrl}/v1/admin/campaign/magic-link/sms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email, phone, smsConsent, consentSource }),
    })

    const text = await res.text()
    if (!res.ok) {
      let message = `gp-api returned ${res.status}.`
      try {
        const parsed = JSON.parse(text)
        message =
          (typeof parsed.message === 'string' && parsed.message) ||
          (typeof parsed.error === 'string' && parsed.error) ||
          message
      } catch (_) {
        if (text) message = `${message} ${text}`
      }
      return { statusCode: res.status, body: { error: message } }
    }

    let data = {}
    try {
      data = JSON.parse(text)
    } catch (_) {
      return {
        statusCode: 502,
        body: { error: 'gp-api returned a non-JSON response.' },
      }
    }

    return {
      statusCode: 200,
      body: { smsSent: Boolean(data.smsSent), smsError: data.smsError || null },
    }
  } catch (e) {
    return {
      statusCode: 502,
      body: {
        error: `Failed to reach gp-api: ${e && e.message ? e.message : String(e)}`,
      },
    }
  }
}

exports.main = async (context = {}) => {
  const token = process.env.GP_API_M2M_TOKEN
  if (!token) {
    return {
      statusCode: 500,
      body: { error: 'GP_API_M2M_TOKEN secret is not configured on this app function.' },
    }
  }

  // GP_API_URL is an optional override. To use it, add it as a secret
  // (`hs secret add GP_API_URL`) and include it in `secretKeys` in
  // win-magic-link-function-hsmeta.json. Otherwise it defaults to prod.
  const gpApiUrl = (process.env.GP_API_URL || DEFAULT_GP_API_URL).replace(/\/+$/, '')

  const props = context.propertiesToSend || {}
  const email = props.email
  if (!email) {
    return {
      statusCode: 400,
      body: { error: 'This contact has no email address, so a link cannot be generated.' },
    }
  }

  const params = context.parameters || {}
  const action = params.action || 'generate'
  if (action === 'fetch') {
    return fetchExistingMagicLink({ gpApiUrl, token, email })
  }
  if (action === 'sms') {
    if (!params.phone) {
      return {
        statusCode: 400,
        body: { error: 'This contact has no phone number, so it cannot be texted.' },
      }
    }
    return textExistingMagicLink({
      gpApiUrl,
      token,
      email,
      phone: String(params.phone),
      smsConsent: Boolean(params.smsConsent),
      consentSource: params.consentSource ? String(params.consentSource) : undefined,
    })
  }

  const payload = {
    email,
    firstName: props.firstname || '',
    lastName: props.lastname || '',
  }
  // When the rep supplied a phone, gp-api texts the freshly minted link as part
  // of this same call — the rep clicked one button.
  if (params.phone) {
    payload.phone = String(params.phone)
    payload.smsConsent = Boolean(params.smsConsent)
    if (params.consentSource) {
      payload.consentSource = String(params.consentSource)
    }
  }

  try {
    const res = await fetch(`${gpApiUrl}/v1/admin/campaign/magic-link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })

    const text = await res.text()
    if (!res.ok) {
      // Surface gp-api's own message (e.g. the name-required or existing-account
      // refusal) so the rep sees actionable guidance instead of a raw status
      // dump. NestJS errors serialize as { statusCode, message, error }.
      let message = `gp-api returned ${res.status}.`
      try {
        const parsed = JSON.parse(text)
        message =
          (typeof parsed.message === 'string' && parsed.message) ||
          (typeof parsed.error === 'string' && parsed.error) ||
          message
      } catch (_) {
        if (text) message = `${message} ${text}`
      }
      return {
        statusCode: res.status,
        body: { error: message },
      }
    }

    let data = {}
    try {
      data = JSON.parse(text)
    } catch (_) {
      return {
        statusCode: 502,
        body: { error: 'gp-api returned a non-JSON response.' },
      }
    }

    if (!data.url) {
      return {
        statusCode: 502,
        body: { error: 'gp-api did not return a magic-link URL.' },
      }
    }

    const { sent, sendError } = await sendMagicLinkEmail({
      email,
      firstName: payload.firstName,
      lastName: payload.lastName,
      url: data.url,
      userId: data.userId,
    })

    const body = { url: data.url, sent }
    if (sendError) body.sendError = sendError
    // Only report SMS state when the rep actually asked for a text, so the card
    // can tell "not requested" apart from "requested and failed".
    if (payload.phone) {
      body.smsSent = Boolean(data.smsSent)
      if (data.smsError) body.smsError = data.smsError
    }

    return { statusCode: 200, body }
  } catch (e) {
    return {
      statusCode: 502,
      body: { error: `Failed to reach gp-api: ${e && e.message ? e.message : String(e)}` },
    }
  }
}
