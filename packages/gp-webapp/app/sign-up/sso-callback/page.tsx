import { AuthenticateWithRedirectCallback } from '@clerk/nextjs'

/**
 * Landing route for Clerk's Google OAuth redirect started from the custom
 * sign-up form (`authenticateWithRedirect`). The Clerk component finishes the
 * handshake and forwards the user to the post-auth redirect resolver.
 */
export default function SignUpSSOCallback() {
  return (
    <div className="flex min-h-[calc(100vh-64px)] items-center justify-center">
      <AuthenticateWithRedirectCallback
        signUpForceRedirectUrl="/post-auth-redirect?source=signup"
        signInForceRedirectUrl="/post-auth-redirect"
      />
    </div>
  )
}
