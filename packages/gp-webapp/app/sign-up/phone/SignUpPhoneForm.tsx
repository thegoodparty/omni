'use client'

import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { AsYouType } from 'libphonenumber-js'
import { Button, GoodPartyOrgLogo, Input, Label, Spinner } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { isValidPhone } from '@shared/inputs/PhoneInput'
import { nextPhoneDigits } from '../phoneUtils'

const NEXT_PATH = '/post-auth-redirect?source=signup'

export default function SignUpPhoneForm() {
  const { isLoaded, isSignedIn, user } = useUser()

  const [phone, setPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const leavingRef = useRef(false)
  const [checking, setChecking] = useState(true)

  const phoneReady = isValidPhone(phone)

  // Only Google signups are routed here, but the page has no server-side
  // auth gate, so anyone signed in can reach it directly — and submitting
  // overwrites User.phone unconditionally. So the question "do they already
  // have a number?" is asked of the user row itself, the same field this
  // step writes. Clerk metadata is no substitute: it is user-writable, and
  // every account created before this step existed has a phone in the
  // database and nothing in metadata, which a metadata-only check would
  // answer wrongly and then clobber on submit.
  useEffect(() => {
    if (!isLoaded || leavingRef.current) return
    if (!isSignedIn) {
      leavingRef.current = true
      window.location.replace('/sign-up')
      return
    }

    let cancelled = false
    const skipIfAlreadyOnRecord = async () => {
      const res = await clientRequest(
        'GET /v1/users/me',
        {},
        { ignoreResponseError: true },
      )
      if (cancelled || leavingRef.current) return
      const onRecord = res.ok
        ? ((res.data as { phone?: string | null }).phone ?? '')
        : ''
      if (isValidPhone(onRecord)) {
        leavingRef.current = true
        window.location.replace(NEXT_PATH)
        return
      }
      // Fails open: a lookup that errored shows the form rather than
      // stranding a genuine new signup on a spinner.
      setChecking(false)
    }
    void skipIfAlreadyOnRecord()
    return () => {
      cancelled = true
    }
  }, [isLoaded, isSignedIn])

  const handleChange = (next: string) => {
    setPhone(nextPhoneDigits(phone, next))
    setError(null)
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (submitting || !user) return
    if (!phoneReady) {
      setError('Please enter your phone number to continue.')
      inputRef.current?.focus()
      return
    }
    setError(null)
    setSubmitting(true)

    // The user row is what HubSpot syncs from, so that write has to land;
    // the Clerk copy only keeps the two profiles consistent with the
    // email/password signup, and is not worth failing the step over.
    const saved = await clientRequest(
      'PUT /v1/users/me',
      { phone },
      { ignoreResponseError: true },
    )
    if (!saved.ok) {
      setError('We could not save your number. Please try again.')
      setSubmitting(false)
      return
    }
    try {
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, phone } })
    } catch {
      // Non-fatal: gp-api already has the number.
    }

    leavingRef.current = true
    window.location.replace(NEXT_PATH)
  }

  if (!isLoaded || checking) {
    return <Spinner />
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-[416px] flex-col gap-6"
      data-testid="signup-phone-form"
    >
      <div className="flex flex-col items-center gap-6">
        <GoodPartyOrgLogo className="h-9 w-12" />
        <div className="flex w-full flex-col gap-3">
          <h1 className="text-center text-[32px] leading-[44px] font-bold text-[#0a0a0a] font-outfit">
            What&rsquo;s your phone number?
          </h1>
          <p className="text-sm leading-5 text-muted-foreground">
            So we can reach you if you need help.
          </p>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Label className="font-medium text-[#0a0a0a]">Phone</Label>
        <Input
          ref={inputRef}
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder="Phone"
          value={new AsYouType('US').input(phone)}
          onChange={(e) => handleChange(e.target.value)}
          aria-invalid={phone.length > 0 && !phoneReady}
          autoFocus
          required
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button
        type="submit"
        className="w-full"
        loading={submitting}
        disabled={!phoneReady}
        data-testid="signup-phone-submit"
      >
        Continue
      </Button>
    </form>
  )
}
