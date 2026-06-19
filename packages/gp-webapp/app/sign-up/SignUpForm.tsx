'use client'

import { type FormEvent, type ReactNode, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSignUp } from '@clerk/nextjs'
import {
  Button,
  Checkbox,
  GoodPartyOrgLogo,
  Input,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  Label,
} from '@styleguide'
import { GoogleIcon } from './GoogleIcon'

const SIGN_UP_REDIRECT = '/post-auth-redirect?source=signup'
const SSO_CALLBACK_URL = '/sign-up/sso-callback'

/**
 * The Clerk Signal API returns a `ClerkError` (with `longMessage`/`message`)
 * from each step method rather than throwing; surface the friendliest text.
 */
const messageFrom = (error: {
  longMessage?: string
  message?: string
}): string =>
  error?.longMessage ||
  error?.message ||
  'Something went wrong. Please try again.'

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex min-w-0 flex-1 flex-col gap-1">
    <Label className="font-medium text-[#0a0a0a]">{label}</Label>
    {children}
  </div>
)

export default function SignUpForm() {
  const router = useRouter()
  const { signUp } = useSignUp()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [agreed, setAgreed] = useState(false)

  const [verifying, setVerifying] = useState(false)
  const [code, setCode] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDetailsSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (submitting) return
    setError(null)
    setSubmitting(true)
    try {
      const { error: passwordError } = await signUp.password({
        emailAddress: email,
        password,
        firstName,
        lastName,
        legalAccepted: agreed,
      })
      if (passwordError) {
        setError(messageFrom(passwordError))
        return
      }

      const { error: sendError } = await signUp.verifications.sendEmailCode()
      if (sendError) {
        setError(messageFrom(sendError))
        return
      }

      setVerifying(true)
    } finally {
      setSubmitting(false)
    }
  }

  const handleVerify = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (submitting) return
    setError(null)
    setSubmitting(true)
    try {
      const { error: verifyError } = await signUp.verifications.verifyEmailCode(
        { code },
      )
      if (verifyError) {
        setError(messageFrom(verifyError))
        return
      }

      if (signUp.status === 'complete') {
        await signUp.finalize({
          navigate: async ({ decorateUrl }) => {
            const url = decorateUrl(SIGN_UP_REDIRECT)
            if (url.startsWith('http')) {
              window.location.href = url
            } else {
              router.push(url)
            }
          },
        })
        return
      }

      setError('We could not verify that code. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleGoogle = async () => {
    if (submitting) return
    setError(null)
    const { error: ssoError } = await signUp.sso({
      strategy: 'oauth_google',
      redirectUrl: SIGN_UP_REDIRECT,
      redirectCallbackUrl: SSO_CALLBACK_URL,
    })
    if (ssoError) {
      setError(messageFrom(ssoError))
    }
  }

  if (verifying) {
    return (
      <div
        className="flex w-full max-w-[416px] flex-col gap-6"
        data-testid="signup-verify"
      >
        <div className="flex flex-col items-center gap-6">
          <GoodPartyOrgLogo className="h-9 w-12" />
          <div className="flex w-full flex-col gap-3">
            <h1 className="text-center text-[32px] leading-[44px] font-bold text-[#0a0a0a] font-[family-name:var(--outfit-font)]">
              Verify your email
            </h1>
            <p className="text-sm leading-5 text-muted-foreground">
              Enter the 6-digit code we sent to{' '}
              <span className="font-medium text-[#0a0a0a]">{email}</span>.
            </p>
          </div>
        </div>

        <form onSubmit={handleVerify} className="flex flex-col gap-4">
          <InputOTP
            maxLength={6}
            value={code}
            onChange={setCode}
            containerClassName="justify-center"
            data-testid="signup-otp-input"
          >
            <InputOTPGroup className="gap-2">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <InputOTPSlot
                  key={i}
                  index={i}
                  className="h-12 w-12 rounded-md border text-lg"
                />
              ))}
            </InputOTPGroup>
          </InputOTP>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <Button
            type="submit"
            className="w-full"
            loading={submitting}
            disabled={code.length < 6}
            data-testid="signup-verify-submit"
          >
            Verify
          </Button>
          <button
            type="button"
            onClick={() => {
              setVerifying(false)
              setCode('')
              setError(null)
            }}
            className="text-center text-sm text-muted-foreground underline"
          >
            Back to sign up
          </button>
        </form>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleDetailsSubmit}
      className="flex w-full max-w-[416px] flex-col gap-6"
      data-testid="signup-form"
    >
      <div className="flex flex-col items-center gap-6">
        <GoodPartyOrgLogo className="h-9 w-12" />
        <div className="flex w-full flex-col gap-3">
          <h1 className="text-center text-[32px] leading-[44px] font-bold text-[#0a0a0a] font-[family-name:var(--outfit-font)]">
            Create an account
          </h1>
          <p className="text-sm leading-5 text-muted-foreground">
            Let&rsquo;s get started. Fill in the details below to create your
            account.
          </p>
        </div>
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={handleGoogle}
        icon={<GoogleIcon className="size-4" />}
        className="w-full border-[#0a0a0a] font-semibold text-[#0a0a0a] hover:bg-[#0a0a0a]/5"
        data-testid="signup-google"
      >
        Sign in with Google
      </Button>

      <div className="flex flex-col gap-4">
        <div className="flex w-full gap-4">
          <Field label="First Name">
            <Input
              name="firstName"
              autoComplete="given-name"
              placeholder="First Name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
          </Field>
          <Field label="Last Name">
            <Input
              name="lastName"
              autoComplete="family-name"
              placeholder="Last Name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />
          </Field>
        </div>

        <Field label="Email">
          <Input
            name="emailAddress"
            type="email"
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>

        <Field label="Password">
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="Create Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          <p className="text-xs leading-4 text-muted-foreground">
            Minimum 8 characters.
          </p>
        </Field>

        <div className="flex w-full items-start gap-2">
          <Checkbox
            id="signup-terms"
            checked={agreed}
            onCheckedChange={(checked) => setAgreed(checked === true)}
            className="mt-1"
            data-testid="signup-terms"
          />
          <Label
            htmlFor="signup-terms"
            className="text-base leading-6 font-normal text-[#0a0a0a]"
          >
            <span>
              I agree to the{' '}
              <Link
                href="/terms-of-service"
                target="_blank"
                className="text-sm underline"
              >
                Terms &amp; Conditions
              </Link>
            </span>
          </Label>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Clerk Smart CAPTCHA / bot-protection mounts here for the custom flow. */}
      <div id="clerk-captcha" />

      <div className="flex w-full flex-col items-center gap-4">
        <Button
          type="submit"
          className="w-full"
          loading={submitting}
          disabled={!agreed}
          data-testid="signup-submit"
        >
          Sign up
        </Button>
        <p className="text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="text-primary underline">
            Sign in
          </Link>
        </p>
      </div>
    </form>
  )
}
