import { AuthenticateWithRedirectCallback } from '@clerk/nextjs'

/**
 * Landing route for Clerk's Google OAuth redirect started from the custom
 * sign-up form (`authenticateWithRedirect`). The Clerk component finishes the
 * handshake and forwards the user on.
 *
 * Clerk only loads this page when the flow needs another step (a transfer to
 * sign-in, missing requirements); a sign-up that completes outright goes
 * straight to the `redirectUrlComplete` the form passed, which is the phone
 * step. The props below cover the cases that do come through here: a new
 * account still goes to `/sign-up/phone`, and a Google *sign-in* takes the
 * sign-in URL and is never asked.
 */
export default function SignUpSSOCallback() {
  return (
    <div className="flex min-h-[calc(100vh-64px)] items-center justify-center">
      <AuthenticateWithRedirectCallback
        signUpForceRedirectUrl="/sign-up/phone"
        signInForceRedirectUrl="/post-auth-redirect"
      />
    </div>
  )
}
