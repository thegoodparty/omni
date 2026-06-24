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

  const payload = {
    email,
    firstName: props.firstname || '',
    lastName: props.lastname || '',
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

    return {
      statusCode: 200,
      body: sendError ? { url: data.url, sent, sendError } : { url: data.url, sent },
    }
  } catch (e) {
    return {
      statusCode: 502,
      body: { error: `Failed to reach gp-api: ${e && e.message ? e.message : String(e)}` },
    }
  }
}
