import { BadGatewayException, Inject, Injectable } from '@nestjs/common'
import { ClerkClient, Invitation } from '@clerk/backend'
import { PinoLogger } from 'nestjs-pino'
import {
  TeamInviteMetadata,
  TeamInviteMetadataSchema,
} from '@goodparty_org/contracts'
import { CLERK_LIST_TIMEOUT_MS } from '@/vendors/clerk/clerk.consts'
import { CLERK_CLIENT_PROVIDER_TOKEN } from '@/vendors/clerk/providers/clerk-client.provider'
import {
  clerkCall,
  ClerkTimeoutError,
} from '@/vendors/clerk/util/clerkCall.util'

// Bounds retries of one page of listPendingTeamInvitations' paging loop —
// not the whole loop, so a persistent failure still fails fast per page
// instead of restarting from offset 0.
const MAX_PAGE_ATTEMPTS = 3 // 1 initial try + 2 retries
const RATE_LIMIT_STATUS = 429
const RETRY_BACKOFF_MS = 300

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

// Clerk's rate-limit error is a plain Error decorated with `status` (and
// sometimes `retryAfter`, in seconds) by the SDK's internal request layer —
// @clerk/backend does not export a class or type guard for it, so narrow
// structurally rather than importing the undeclared @clerk/shared package
// that actually defines the shape.
const isClerkRateLimitError = (
  err: unknown,
): err is Error & { status: number; retryAfter?: number } =>
  err instanceof Error && 'status' in err && err.status === RATE_LIMIT_STATUS

// Retries one page fetch on a Clerk timeout or 429; any other error (or
// exhausted retries) propagates so the caller's existing catch still maps it
// to BadGatewayException.
const fetchPageWithRetry = async <T>(
  fetchPage: () => Promise<T>,
): Promise<T> => {
  let lastErr: unknown
  for (let attempt = 0; attempt < MAX_PAGE_ATTEMPTS; attempt++) {
    try {
      return await fetchPage()
    } catch (err) {
      lastErr = err
      const isTimeout = err instanceof ClerkTimeoutError
      const isRateLimit = isClerkRateLimitError(err)
      if (!isTimeout && !isRateLimit) throw err
      if (attempt === MAX_PAGE_ATTEMPTS - 1) break
      const delayMs =
        isRateLimit && typeof err.retryAfter === 'number'
          ? err.retryAfter * 1000
          : RETRY_BACKOFF_MS
      await sleep(delayMs)
    }
  }
  throw lastErr
}

// Thin wrapper over clerkClient.invitations.* — pending team invites live in
// Clerk, not Postgres (a pending invite is identity state, not a
// permission). publicMetadata is Clerk's whole persistence mechanism: it
// copies onto the user at sign-up, so the accept endpoint can read it back.
@Injectable()
export class ClerkInvitationsService {
  constructor(
    @Inject(CLERK_CLIENT_PROVIDER_TOKEN)
    private readonly clerkClient: ClerkClient,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ClerkInvitationsService.name)
  }

  async createTeamInvitation({
    emailAddress,
    redirectUrl,
    publicMetadata,
  }: {
    emailAddress: string
    redirectUrl: string
    publicMetadata: TeamInviteMetadata
  }): Promise<Invitation> {
    try {
      return await clerkCall(
        'invitations.createInvitation',
        { 'clerk.organization_slug': publicMetadata.organizationSlug },
        () =>
          this.clerkClient.invitations.createInvitation({
            emailAddress,
            redirectUrl,
            publicMetadata,
          }),
      )
    } catch (err) {
      this.logger.error({ err }, 'Failed to create Clerk team invitation')
      throw new BadGatewayException('Failed to create team invitation')
    }
  }

  async listPendingTeamInvitations(
    organizationSlug: string,
  ): Promise<Invitation[]> {
    // `getInvitationList` has no server-side org filter — it returns pending
    // invitations across every org in the Clerk instance, so a single
    // (even max-size) page silently drops invitations once the instance-wide
    // pending count exceeds it. Page with limit+offset until totalCount is
    // exhausted, THEN filter to this org, so no team's invites can fall off
    // the end of someone else's backlog.
    const invitations: Invitation[] = []
    try {
      const PAGE_SIZE = 500 // Clerk's documented page-size ceiling
      let offset = 0
      let totalCount = Infinity
      while (offset < totalCount) {
        const page = await fetchPageWithRetry(() =>
          clerkCall(
            'invitations.getInvitationList',
            {
              'clerk.organization_slug': organizationSlug,
              'clerk.offset': offset,
            },
            () =>
              this.clerkClient.invitations.getInvitationList({
                status: 'pending',
                limit: PAGE_SIZE,
                offset,
              }),
            CLERK_LIST_TIMEOUT_MS,
          ),
        )
        invitations.push(...page.data)
        totalCount = page.totalCount
        offset += PAGE_SIZE
      }
    } catch (err) {
      this.logger.error({ err }, 'Failed to list Clerk team invitations')
      throw new BadGatewayException('Failed to list team invitations')
    }

    return invitations.filter((invitation) => {
      const metadata = TeamInviteMetadataSchema.safeParse(
        invitation.publicMetadata,
      )
      return (
        metadata.success && metadata.data.organizationSlug === organizationSlug
      )
    })
  }

  async revokeInvitation(invitationId: string): Promise<Invitation> {
    try {
      return await clerkCall(
        'invitations.revokeInvitation',
        { 'clerk.invitation_id': invitationId },
        () => this.clerkClient.invitations.revokeInvitation(invitationId),
      )
    } catch (err) {
      this.logger.error({ err }, 'Failed to revoke Clerk team invitation')
      throw new BadGatewayException('Failed to revoke team invitation')
    }
  }

  // Reads the invite payload straight off the invitee's own Clerk user —
  // Clerk copies an invitation's publicMetadata onto the user at sign-up, so
  // this is the only place the accept endpoint may read it from (never the
  // request body). A shape that doesn't parse (already accepted, cleared, or
  // never invited) is "no invite", not an error.
  //
  // Also returns the user's VERIFIED email addresses off the same Clerk
  // read, so callers can fall back to the pending-invitation lookup for an
  // invitee who signed up organically and never received the metadata copy
  // (ENG-11027). Unverified addresses are excluded on purpose: an unverified
  // email must never be able to redeem an invitation addressed to it.
  async getTeamInviteState(clerkId: string): Promise<{
    metadata: TeamInviteMetadata | null
    verifiedEmails: string[]
  }> {
    let user
    try {
      user = await clerkCall(
        'users.getUser',
        { 'clerk.user_id': clerkId },
        () => this.clerkClient.users.getUser(clerkId),
      )
    } catch (err) {
      this.logger.error(
        { err },
        'Failed to fetch Clerk user for invite acceptance',
      )
      throw new BadGatewayException('Failed to fetch Clerk user')
    }

    const metadata = TeamInviteMetadataSchema.safeParse(user.publicMetadata)
    return {
      metadata: metadata.success ? metadata.data : null,
      verifiedEmails: user.emailAddresses
        .filter((email) => email.verification?.status === 'verified')
        .map((email) => email.emailAddress.toLowerCase()),
    }
  }

  // Pending team invitations addressed to one email. `query` filters
  // server-side (Clerk matches it against email_address or id, possibly
  // partially), so the exact-email match is re-checked here, and
  // invitations that aren't team invites (no parseable TeamInviteMetadata)
  // are dropped.
  async findPendingTeamInvitationsByEmail(
    email: string,
  ): Promise<Invitation[]> {
    const normalized = email.toLowerCase()
    try {
      const { data } = await clerkCall(
        'invitations.getInvitationList',
        { 'clerk.email': normalized },
        () =>
          this.clerkClient.invitations.getInvitationList({
            status: 'pending',
            query: normalized,
            limit: 500,
          }),
      )
      return data.filter(
        (invitation) =>
          invitation.emailAddress.toLowerCase() === normalized &&
          TeamInviteMetadataSchema.safeParse(invitation.publicMetadata).success,
      )
    } catch (err) {
      this.logger.error(
        { err },
        'Failed to look up Clerk team invitations by email',
      )
      throw new BadGatewayException('Failed to look up team invitations')
    }
  }

  // Clears the invite keys after acceptance so the pending-invite payload
  // can't be read (or re-accepted against) again. Called after the DB
  // commit — a null here deletes the key rather than setting it, which is
  // Clerk metadata's merge-patch semantics.
  async clearTeamInviteMetadata(clerkId: string): Promise<void> {
    try {
      await clerkCall(
        'users.updateUserMetadata',
        { 'clerk.user_id': clerkId },
        () =>
          this.clerkClient.users.updateUserMetadata(clerkId, {
            publicMetadata: {
              organizationSlug: null,
              role: null,
              name: null,
              invitedByUserId: null,
            },
          }),
      )
    } catch (err) {
      this.logger.error({ err }, 'Failed to clear Clerk team invite metadata')
      throw new BadGatewayException('Failed to clear team invite metadata')
    }
  }

  // Revoking a Clerk invitation cancels the invitation object, but an
  // invitee who already signed up via the invite link carries the same
  // publicMetadata on their own Clerk user — and accept reads only that, not
  // the invitation. So a revoke must also clear the invitee's user metadata
  // if they exist, or a revoked invite can still be accepted. No matching
  // user (never signed up) is a no-op, not an error.
  async clearTeamInviteMetadataByEmail(email: string): Promise<void> {
    let users
    try {
      ;({ data: users } = await clerkCall(
        'users.getUserList',
        { 'clerk.email': email },
        () =>
          this.clerkClient.users.getUserList({
            emailAddress: [email],
            limit: 1,
          }),
      ))
    } catch (err) {
      this.logger.error(
        { err },
        'Failed to look up Clerk user by email for invite revocation',
      )
      throw new BadGatewayException('Failed to look up Clerk user')
    }

    const user = users[0]
    if (!user) return

    await this.clearTeamInviteMetadata(user.id)
  }
}
