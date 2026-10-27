type ClerkEmail = {
  emailAddress: string
  verification?: { status?: string | null } | null
}

const isVerified = (
  email: ClerkEmail | null | undefined,
): email is ClerkEmail => email?.verification?.status === 'verified'

// The only addresses gp-api copies into User.email. User.email gates staff and
// test-user affordances (isInternalUser, isTestUser), so an address the user
// has not proven they own must never reach it.
export const verifiedEmailOf = (clerkUser: {
  primaryEmailAddress?: ClerkEmail | null
  emailAddresses?: ClerkEmail[] | null
}): string | undefined => {
  if (isVerified(clerkUser.primaryEmailAddress)) {
    return clerkUser.primaryEmailAddress.emailAddress
  }
  return clerkUser.emailAddresses?.find(isVerified)?.emailAddress
}
