'use server'

import { auth, currentUser } from '@clerk/nextjs/server'
import { PERMISSIONS } from '@/lib/permissions'
import { gpAction } from '@/shared/util/gpClient.util'

/**
 * The operator's own email, sent to gp-api as the actor on every request
 * below. gp-admin authenticates to gp-api with a shared M2M token, so this is
 * the only point in the chain where the human is known. Issuing a transfer
 * code hands control of the domain to whoever receives it, so an unattributed
 * issuance is not worth recording at all — fail rather than substitute a
 * placeholder.
 */
async function requireActorEmail(): Promise<string> {
  const { has } = await auth()
  // Clerk hands back `has: null` for an unauthenticated session, so calling it
  // unguarded surfaces a TypeError instead of the permission failure.
  if (!has?.({ permission: PERMISSIONS.WRITE_CAMPAIGNS })) {
    throw new Error('Missing write_campaigns permission')
  }

  const user = await currentUser()
  const email = user?.primaryEmailAddress?.emailAddress
  if (!email) {
    throw new Error('Could not determine which operator is acting')
  }
  return email
}

export type IssueAuthCodeResult =
  | { ok: true; authCode: string }
  | { ok: false; error: string }

/**
 * Issues the registrar auth code a candidate needs to move their domain to
 * another registrar.
 *
 * Returns errors as data rather than throwing: gp-api's refusals here are
 * mostly things the operator has to read and act on — a domain still inside
 * ICANN's 60-day post-registration lock names the date it lifts, and a domain
 * we never registered needs escalating rather than retrying.
 */
export const issueDomainAuthCode = async (
  domain: string
): Promise<IssueAuthCodeResult> => {
  const actorEmail = await requireActorEmail()

  const trimmed = domain.trim().toLowerCase()
  if (!trimmed) {
    return { ok: false, error: 'Enter a domain.' }
  }

  try {
    const { authCode } = await gpAction((client) =>
      client.domains.getAuthCode({ domain: trimmed, actorEmail })
    )
    return { ok: true, authCode }
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Could not reach gp-api to request the auth code.',
    }
  }
}
