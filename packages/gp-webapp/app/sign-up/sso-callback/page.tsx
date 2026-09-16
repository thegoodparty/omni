import { AuthenticateWithRedirectCallback } from '@clerk/nextjs'

/**
 * Landing route for Clerk's Google OAuth redirect started from the custom
 * sign-up form (`authenticateWithRedirect`). The Clerk component finishes the
 * handshake and forwards the user on.
 *
 * New accounts go to `/sign-up/phone` first: the email/password form collects
 * a phone up front, but OAuth can't, and that step forwards to the same
 * post-auth resolver once it has one. A Google *sign-in* takes the
 * sign-in URL below and is never asked.
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
