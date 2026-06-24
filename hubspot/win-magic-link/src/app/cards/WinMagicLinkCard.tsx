import React, { useState } from 'react'
import {
  Alert,
  Button,
  Flex,
  Input,
  LoadingSpinner,
  Text,
  hubspot,
} from '@hubspot/ui-extensions'
import { useCrmProperties } from '@hubspot/ui-extensions/crm'

// uid of the app function declared in
// /app/functions/win-magic-link-function-hsmeta.json. The serverless
// function is the only place the gp-api M2M token lives — the card never
// sees it.
const FUNCTION_UID = 'win_magic_link_function'

// Contact properties forwarded to the serverless function and shown to the rep
// for confirmation before generating the link.
const CONTACT_PROPERTIES = ['email', 'firstname', 'lastname']

// `propertiesToSend` is passed at call time on 2026.03 (it is no longer
// declared in the card's *-hsmeta.json config); the function reads them from
// `context.propertiesToSend`.
hubspot.extend<'crm.record.tab'>(({ actions }) => (
  <WinMagicLinkCard actions={actions} />
))

type Actions = {
  addAlert: (opts: {
    title?: string
    message: string
    type: 'info' | 'tip' | 'success' | 'warning' | 'danger'
  }) => void
  copyTextToClipboard: (text: string) => Promise<void>
}

type ServerlessResult = {
  body?: {
    url?: string
    error?: string
    sent?: boolean
    sendError?: string
  }
}

function WinMagicLinkCard({ actions }: { actions: Actions }) {
  const {
    properties,
    isLoading: loadingContact,
    error: contactError,
  } = useCrmProperties(CONTACT_PROPERTIES)

  const [submitting, setSubmitting] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const email = (properties?.email as string | undefined) || ''
  const firstName = (properties?.firstname as string | undefined) || ''
  const lastName = (properties?.lastname as string | undefined) || ''
  const fullName =
    [firstName, lastName].filter(Boolean).join(' ') || '(no name on contact)'
  // gp-api rejects blank first/last names, so block the request up front and
  // tell the rep how to fix it rather than waiting for the 400 round-trip.
  const nameMissing = !firstName.trim() || !lastName.trim()

  const generate = async () => {
    setSubmitting(true)
    setError(null)
    setUrl(null)
    setSent(false)
    setSendError(null)
    try {
      const result = (await hubspot.serverless(FUNCTION_UID, {
        propertiesToSend: CONTACT_PROPERTIES,
      })) as ServerlessResult
      const body = result?.body ?? {}
      if (body.error || !body.url) {
        throw new Error(body.error || 'No magic link was returned.')
      }
      setUrl(body.url)
      setSent(body.sent === true)
      setSendError(body.sendError ?? null)
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

  const copy = async () => {
    if (!url) return
    try {
      await actions.copyTextToClipboard(url)
      actions.addAlert({ type: 'success', message: 'Magic link copied to clipboard.' })
    } catch {
      actions.addAlert({
        type: 'warning',
        message: "Couldn't copy automatically — select the link field and copy manually.",
      })
    }
  }

  if (loadingContact) {
    return <LoadingSpinner label="Loading contact…" showLabel />
  }

  return (
    <Flex direction="column" gap="md">
      <Alert title="Internal testing tool" variant="info">
        Generates a one-click candidate onboarding link for this contact and
        emails it to them automatically. Not for production use yet — confirm the
        contact details below before sending.
      </Alert>

      {contactError ? (
        <Alert title="Couldn't read this contact" variant="danger">
          {contactError.message}
        </Alert>
      ) : null}

      <Flex direction="column" gap="xs">
        <Text format={{ fontWeight: 'bold' }}>This link will onboard:</Text>
        <Text>{fullName}</Text>
        <Text format={{ fontWeight: 'demibold' }}>
          {email || '(no email — cannot generate a link)'}
        </Text>
        <Text variant="microcopy">
          The candidate signs in and picks their office to start onboarding.
        </Text>
      </Flex>

      {nameMissing && email ? (
        <Alert title="Add a first and last name first" variant="warning">
          This contact is missing a first or last name. Add both to the HubSpot
          contact, then reload this card to generate the link.
        </Alert>
      ) : null}

      <Button
        variant="primary"
        onClick={generate}
        disabled={submitting || !email || nameMissing}
      >
        {submitting ? 'Sending…' : 'Generate & send magic link'}
      </Button>

      {error ? (
        <Alert title="Could not create link" variant="danger">
          {error}
        </Alert>
      ) : null}

      {url ? (
        <Flex direction="column" gap="sm">
          {sent ? (
            <Alert title="Email sent" variant="success">
              Magic link emailed to {email}. The copyable link below is a
              fallback if it doesn't arrive.
            </Alert>
          ) : (
            <Alert title="Auto-send failed — copy the link manually" variant="warning">
              The magic link was generated, but emailing it automatically
              failed{sendError ? `: ${sendError}` : '.'} Copy the link below and
              send it to the candidate manually.
            </Alert>
          )}
          <Input name="magic-link-url" label="Magic link" readOnly value={url} />
          <Button onClick={copy}>Copy link</Button>
        </Flex>
      ) : null}
    </Flex>
  )
}

export default WinMagicLinkCard
