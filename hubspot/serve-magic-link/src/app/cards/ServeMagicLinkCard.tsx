import React, { useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Flex,
  Input,
  LoadingSpinner,
  Text,
  hubspot,
} from '@hubspot/ui-extensions'
import { useCrmProperties } from '@hubspot/ui-extensions/crm'

// uid of the app function declared in
// /app/functions/serve-magic-link-function-hsmeta.json. The serverless
// function is the only place the gp-api M2M token lives — the card never
// sees it.
const FUNCTION_UID = 'serve_magic_link_function'

// Contact properties forwarded to the serverless function and shown to the rep
// for confirmation before generating the link. The `eo_magic_link_*` /
// `eo_onboarding_completed_at` properties are written by gp-api (it mirrors the
// magic-link lifecycle onto the contact) and read here so the card shows
// persistent state — link present until expired/consumed, redeemed, onboarded —
// across card close/reopen. They are read-only to this card.
//
// The redemption URL is deliberately NOT among these: it carries a live
// single-use sign-in ticket, so gp-api never mirrors it to HubSpot. When the
// rep needs to copy an active link, the card fetches it on demand via the
// serverless function (action: 'fetch'), keeping the credential out of CRM.
const CONTACT_PROPERTIES = [
  'email',
  'firstname',
  'lastname',
  'br_person_id',
  // `mobilephone` is preferred over `phone` for texting — a landline in `phone`
  // would silently fail to deliver.
  'phone',
  'mobilephone',
  'eo_magic_link_status',
  'eo_magic_link_sent_at',
  'eo_magic_link_expires_at',
  'eo_magic_link_redeemed_at',
  'eo_onboarding_completed_at',
]

// `propertiesToSend` is passed at call time on 2026.03 (it is no longer
// declared in the card's *-hsmeta.json config); the function reads them from
// `context.propertiesToSend`.
hubspot.extend<'crm.record.tab'>(({ actions, context }) => (
  <ServeMagicLinkCard actions={actions} context={context} />
))

type Actions = {
  addAlert: (opts: {
    title?: string
    message: string
    type: 'info' | 'tip' | 'success' | 'warning' | 'danger'
  }) => void
  copyTextToClipboard: (text: string) => Promise<void>
}

// Only the rep's identity is read, and only to attribute the consent record.
type CardContext = { user?: { email?: string } }

type ServerlessResult = {
  body?: {
    url?: string | null
    error?: string
    sent?: boolean
    sendError?: string
    status?: string | null
    smsSent?: boolean
    smsError?: string | null
  }
}

// HubSpot returns datetime properties either as ISO-8601 strings or as epoch
// milliseconds (date pickers). Parse both; return null on anything unparseable
// or blank (gp-api sends '' to clear a transition).
function parseHsDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const numeric = Number(value)
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDate(date: Date | null): string {
  if (!date) return ''
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

type LifecycleView =
  | { state: 'none' }
  | { state: 'active'; sentAt: Date | null; expiresAt: Date | null }
  | { state: 'expired'; sentAt: Date | null; expiresAt: Date | null }
  | { state: 'redeemed'; redeemedAt: Date | null }
  | { state: 'completed'; completedAt: Date | null }

// Derives the persistent lifecycle view from the gp-api-written contact
// properties. Status is recomputed from timestamps (not read from
// `eo_magic_link_status`) so expiry flips correctly at read time. Progress
// (redeemed / completed) always wins over expiry. The URL is no longer mirrored
// to HubSpot, so the "active" signal is the presence of a `sent_at` timestamp;
// the actual link is fetched on demand (see `copyExisting`).
function deriveLifecycle(
  properties: Record<string, unknown> | undefined,
  now: Date,
): LifecycleView {
  const completedAt = parseHsDate(properties?.eo_onboarding_completed_at)
  if (completedAt) return { state: 'completed', completedAt }

  const redeemedAt = parseHsDate(properties?.eo_magic_link_redeemed_at)
  if (redeemedAt) return { state: 'redeemed', redeemedAt }

  const sentAt = parseHsDate(properties?.eo_magic_link_sent_at)
  if (!sentAt) return { state: 'none' }

  const expiresAt = parseHsDate(properties?.eo_magic_link_expires_at)
  if (expiresAt && expiresAt.getTime() < now.getTime()) {
    return { state: 'expired', sentAt, expiresAt }
  }
  return { state: 'active', sentAt, expiresAt }
}

function ServeMagicLinkCard({
  actions,
  context,
}: {
  actions: Actions
  context?: CardContext
}) {
  const {
    properties,
    isLoading: loadingContact,
    error: contactError,
  } = useCrmProperties(CONTACT_PROPERTIES)

  const [submitting, setSubmitting] = useState(false)
  // Link returned by the most recent generate in THIS card session. Shown
  // immediately so the rep can copy/confirm without waiting for the contact
  // properties to refresh; on reopen, the persisted properties drive the view.
  const [freshUrl, setFreshUrl] = useState<string | null>(null)
  // Link fetched on demand for an already-sent (persisted) active link. The URL
  // is never stored in HubSpot, so it's pulled from gp-db only when the rep
  // clicks "Copy magic link", then kept in memory for the rest of the session.
  const [fetchedUrl, setFetchedUrl] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)
  const [sent, setSent] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The rep ticks this on the call, when the lead says yes to being texted. It
  // is a claim recorded against the user in gp-db, which enforces consent
  // server-side — this checkbox is the capture point, not the control.
  const [smsConsent, setSmsConsent] = useState(false)
  const [texting, setTexting] = useState(false)
  const [smsSent, setSmsSent] = useState(false)
  const [smsError, setSmsError] = useState<string | null>(null)

  const email = (properties?.email as string | undefined) || ''
  const firstName = (properties?.firstname as string | undefined) || ''
  const lastName = (properties?.lastname as string | undefined) || ''
  const brPersonId = (properties?.br_person_id as string | undefined) || ''
  // Prefer the mobile number: a landline in `phone` would accept the send and
  // never deliver.
  const phone =
    (properties?.mobilephone as string | undefined) ||
    (properties?.phone as string | undefined) ||
    ''
  const consentSource = context?.user?.email
    ? `hubspot_card:${context.user.email}`
    : 'hubspot_card'
  const canText = Boolean(phone) && smsConsent
  const fullName =
    [firstName, lastName].filter(Boolean).join(' ') || '(no name on contact)'
  // gp-api rejects blank first/last names, so block the request up front and
  // tell the rep how to fix it rather than waiting for the 400 round-trip.
  const nameMissing = !firstName.trim() || !lastName.trim()

  const lifecycle = deriveLifecycle(properties, new Date())

  // `withSms` texts the new link in the same round-trip, so the rep on a call
  // clicks one button rather than generate-then-text.
  const generate = async (withSms = false) => {
    setSubmitting(true)
    setError(null)
    setFreshUrl(null)
    setSent(false)
    setSendError(null)
    setSmsSent(false)
    setSmsError(null)
    try {
      const result = (await hubspot.serverless(FUNCTION_UID, {
        propertiesToSend: CONTACT_PROPERTIES,
        parameters: withSms
          ? { action: 'generate', phone, smsConsent, consentSource }
          : { action: 'generate' },
      })) as ServerlessResult
      const body = result?.body ?? {}
      if (body.error || !body.url) {
        throw new Error(body.error || 'No magic link was returned.')
      }
      setFreshUrl(body.url)
      setSent(body.sent === true)
      setSendError(body.sendError ?? null)
      if (withSms) {
        setSmsSent(body.smsSent === true)
        setSmsError(body.smsError ?? null)
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Unexpected error generating the magic link.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const copy = async (link: string) => {
    try {
      await actions.copyTextToClipboard(link)
      actions.addAlert({ type: 'success', message: 'Magic link copied to clipboard.' })
    } catch {
      actions.addAlert({
        type: 'warning',
        message: "Couldn't copy automatically — select the link field and copy manually.",
      })
    }
  }

  // Fetches the persisted active link on demand (it isn't mirrored to HubSpot),
  // reveals it in the field, and copies it. gp-api returns no URL once the link
  // is consumed/expired, in which case we tell the rep to reload.
  const copyExisting = async () => {
    setFetching(true)
    try {
      const result = (await hubspot.serverless(FUNCTION_UID, {
        propertiesToSend: CONTACT_PROPERTIES,
        parameters: { action: 'fetch' },
      })) as ServerlessResult
      const body = result?.body ?? {}
      if (body.error) {
        throw new Error(body.error)
      }
      if (!body.url) {
        actions.addAlert({
          type: 'warning',
          message:
            "This link is no longer available — it may have been used or expired. Reload the card to refresh its status.",
        })
        return
      }
      setFetchedUrl(body.url)
      await copy(body.url)
    } catch (e) {
      actions.addAlert({
        type: 'danger',
        message:
          e instanceof Error ? e.message : 'Could not fetch the magic link.',
      })
    } finally {
      setFetching(false)
    }
  }

  // Texts the lead's CURRENT link, for when they never received the email. This
  // deliberately does not mint a new link — that would rotate the short-link
  // slug and kill the one already sitting in their inbox.
  const textExisting = async () => {
    setTexting(true)
    setSmsError(null)
    try {
      const result = (await hubspot.serverless(FUNCTION_UID, {
        propertiesToSend: CONTACT_PROPERTIES,
        parameters: { action: 'sms', phone, smsConsent, consentSource },
      })) as ServerlessResult
      const body = result?.body ?? {}
      if (body.error) {
        throw new Error(body.error)
      }
      setSmsSent(body.smsSent === true)
      setSmsError(body.smsError ?? null)
      if (body.smsSent) {
        actions.addAlert({ type: 'success', message: `Magic link texted to ${phone}.` })
      } else {
        actions.addAlert({
          type: 'warning',
          message: body.smsError || 'The text could not be sent.',
        })
      }
    } catch (e) {
      actions.addAlert({
        type: 'danger',
        message: e instanceof Error ? e.message : 'Could not text the magic link.',
      })
    } finally {
      setTexting(false)
    }
  }

  if (loadingContact) {
    return <LoadingSpinner label="Loading contact…" showLabel />
  }

  // A URL we currently hold in memory: freshly generated this session, or
  // fetched on demand for a persisted active link. The persisted link's URL is
  // never read from properties (it isn't mirrored), so until the rep fetches it
  // this is null and the card shows a "Copy magic link" button instead.
  const activeUrl = freshUrl ?? fetchedUrl
  // A regenerate is allowed once a link has lapsed or been consumed but the
  // official hasn't finished onboarding (e.g. expired, or a stalled redeemer).
  const canRegenerate =
    lifecycle.state === 'none' ||
    lifecycle.state === 'expired' ||
    lifecycle.state === 'redeemed'
  const showGenerateButton = !activeUrl && canRegenerate

  return (
    <Flex direction="column" gap="md">
      <Alert title="Send onboarding magic link" variant="info">
        Generates a one-click elected-official onboarding link for this contact
        and emails it to them automatically. Confirm the contact details below
        before sending.
      </Alert>

      {contactError ? (
        <Alert title="Couldn't read this contact" variant="danger">
          {contactError.message}
        </Alert>
      ) : null}

      {/* Persistent lifecycle status, driven by gp-api-written properties. */}
      {lifecycle.state === 'completed' ? (
        <Alert title="Onboarding complete" variant="success">
          This official finished onboarding
          {lifecycle.completedAt
            ? ` on ${formatDate(lifecycle.completedAt)}`
            : ''}
          . No further action needed.
        </Alert>
      ) : null}

      {lifecycle.state === 'redeemed' && !freshUrl ? (
        <Alert title="Link redeemed — onboarding in progress" variant="info">
          This official signed in with their magic link
          {lifecycle.redeemedAt
            ? ` on ${formatDate(lifecycle.redeemedAt)}`
            : ''}{' '}
          and is completing onboarding.
        </Alert>
      ) : null}

      {lifecycle.state === 'expired' && !freshUrl ? (
        <Alert title="Magic link expired" variant="warning">
          The previous link
          {lifecycle.expiresAt
            ? ` expired on ${formatDate(lifecycle.expiresAt)}`
            : ' has expired'}{' '}
          and was never redeemed. Generate a new one below.
        </Alert>
      ) : null}

      <Flex direction="column" gap="xs">
        <Text format={{ fontWeight: 'bold' }}>This link will onboard:</Text>
        <Text>{fullName}</Text>
        <Text format={{ fontWeight: 'demibold' }}>
          {email || '(no email — cannot generate a link)'}
        </Text>
        <Text variant="microcopy">
          {brPersonId
            ? `BallotReady id ${brPersonId} found — office and term dates will be pre-filled.`
            : 'No br_person_id on this contact — the official onboards, but nothing is pre-filled.'}
        </Text>
      </Flex>

      {/* SMS consent capture. Required before any text: gp-api refuses the send
          without it, and records it against the user so it outlives this link. */}
      <Flex direction="column" gap="xs">
        <Text format={{ fontWeight: 'bold' }}>Text the link</Text>
        {phone ? (
          <>
            <Text format={{ fontWeight: 'demibold' }}>{phone}</Text>
            <Checkbox
              name="sms-consent"
              checked={smsConsent}
              onChange={(checked) => setSmsConsent(checked)}
            >
              This official agreed on this call to be texted their sign-in link.
            </Checkbox>
          </>
        ) : (
          <Text variant="microcopy">
            No phone or mobile number on this contact — add one to text the link.
          </Text>
        )}
      </Flex>

      {nameMissing && email ? (
        <Alert title="Add a first and last name first" variant="warning">
          This contact is missing a first or last name. Add both to the HubSpot
          contact, then reload this card to generate the link.
        </Alert>
      ) : null}

      {showGenerateButton ? (
        <Flex direction="column" gap="sm">
          <Button
            variant="primary"
            onClick={() => generate(false)}
            disabled={submitting || !email || nameMissing}
          >
            {submitting
              ? 'Sending…'
              : lifecycle.state === 'none'
                ? 'Generate & email magic link'
                : 'Generate & email a new link'}
          </Button>
          <Button
            onClick={() => generate(true)}
            disabled={submitting || !email || nameMissing || !canText}
          >
            {submitting ? 'Sending…' : 'Generate & text link'}
          </Button>
          {phone && !smsConsent ? (
            <Text variant="microcopy">
              Confirm consent above to enable texting.
            </Text>
          ) : null}
        </Flex>
      ) : null}

      {error ? (
        <Alert title="Could not create link" variant="danger">
          {error}
        </Alert>
      ) : null}

      {/* Persisted active link with no URL in memory yet — the URL isn't stored
          in HubSpot, so offer to fetch + copy it on demand. */}
      {lifecycle.state === 'active' && !activeUrl ? (
        <Flex direction="column" gap="sm">
          <Alert title="Magic link active" variant="success">
            A magic link has been sent to {email}
            {lifecycle.expiresAt
              ? ` and is valid until ${formatDate(lifecycle.expiresAt)}`
              : ''}
            . For security the link isn't stored in HubSpot — click below to
            fetch and copy it.
          </Alert>
          <Button variant="primary" onClick={copyExisting} disabled={fetching}>
            {fetching ? 'Fetching…' : 'Copy magic link'}
          </Button>
          <Button onClick={textExisting} disabled={texting || !canText}>
            {texting ? 'Texting…' : 'Text link'}
          </Button>
        </Flex>
      ) : null}

      {/* The active, still-redeemable link we hold in memory (fresh from this
          session, or just fetched on demand). Present until it expires or is
          consumed. */}
      {activeUrl ? (
        <Flex direction="column" gap="sm">
          {freshUrl ? (
            sent ? (
              <Alert title="Email sent" variant="success">
                Magic link emailed to {email}. The copyable link below is a
                fallback if it doesn't arrive.
              </Alert>
            ) : (
              <Alert title="Auto-send failed — copy the link manually" variant="warning">
                The magic link was generated, but emailing it automatically
                failed{sendError ? `: ${sendError}` : '.'} Copy the link below and
                send it to the elected official manually.
              </Alert>
            )
          ) : (
            <Alert title="Magic link active" variant="success">
              A magic link has been sent to {email}
              {lifecycle.state === 'active' && lifecycle.expiresAt
                ? ` and is valid until ${formatDate(lifecycle.expiresAt)}`
                : ''}
              . Copy it below to resend.
            </Alert>
          )}
          {smsSent ? (
            <Alert title="Text sent" variant="success">
              Magic link texted to {phone}.
            </Alert>
          ) : null}
          {smsError ? (
            <Alert title="Text not sent" variant="warning">
              {smsError} Copy the link below and send it manually.
            </Alert>
          ) : null}
          <Input name="magic-link-url" label="Magic link" readOnly value={activeUrl} />
          <Button onClick={() => copy(activeUrl)}>Copy link</Button>
          <Button onClick={textExisting} disabled={texting || !canText}>
            {texting ? 'Texting…' : 'Text link'}
          </Button>
        </Flex>
      ) : null}
    </Flex>
  )
}

export default ServeMagicLinkCard
