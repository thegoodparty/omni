import {
  DEFAULT_PAGINATION_LIMIT,
  DEFAULT_PAGINATION_OFFSET,
  DEFAULT_SORT_BY,
  DEFAULT_SORT_ORDER,
} from '@/shared/constants/paginationOptions.consts'
import { CLERK_CLIENT_PROVIDER_TOKEN } from '@/vendors/clerk/providers/clerk-client.provider'
import { ClerkUserEnricherService } from '@/vendors/clerk/services/clerk-user-enricher.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { ClerkClient } from '@clerk/backend'
import { type ListUsersPagination } from '@goodparty_org/contracts'
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
} from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { Campaign, Prisma, User } from '../../generated/prisma'
import { isPrismaError } from 'src/prisma/util/prismaErrors.util'
import { subHours } from 'date-fns'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import {
  PaginatedResults,
  WithOptional,
  WrapperType,
} from 'src/shared/types/utility.types'
import Stripe from 'stripe'
import { AnalyticsService } from '../../analytics/analytics.service'
import { toLowerAndTrim, trimMany } from '../../shared/util/strings.util'
import { StripeService } from '../../vendors/stripe/services/stripe.service'
import {
  CreateUserInputDto,
  SIGN_UP_MODE,
} from '../schemas/CreateUserInput.schema'
import { hashPassword } from '../util/passwords.util'
import { TEST_USER_DOMAIN } from '../util/users.util'
import { APP_ROOT } from 'src/shared/util/appEnvironment.util'
import { CrmUsersService } from './crmUsers.service'
import { clerkThrottle } from '@/vendors/clerk/util/clerkThrottle.util'

/** Result of resolving a gp-api Clerk user by email for impersonation actor.sub. */
export type ResolvedActorIdentity =
  | { source: 'clerk'; clerkId: string }
  | { source: 'email-fallback'; email: string }

const REGISTER_USER_CRM_FORM_ID = '37d98f01-7062-405f-b0d1-c95179057db1'

const CLERK_PAGE_SIZE = 500

// Refusal shown to sales when an EO magic link targets an email that already
// belongs to a real, self-owned GoodParty login (password set or owns a
// campaign). Reusing such an account would hand an admin-initiated sign-in
// token to someone else's account.
export const EXISTING_ACCOUNT_MAGIC_LINK_ERROR =
  "This email already belongs to an existing GoodParty account and can't be sent an elected-official magic link."

@Injectable()
export class UsersService extends createPrismaBase(MODELS.User) {
  constructor(
    @Inject(forwardRef(() => AnalyticsService))
    private readonly analytics: WrapperType<AnalyticsService>,
    @Inject(forwardRef(() => CrmUsersService))
    private readonly crm: WrapperType<CrmUsersService>,
    @Inject(forwardRef(() => StripeService))
    private readonly stripeService: WrapperType<StripeService>,
    @Inject(forwardRef(() => ClerkUserEnricherService))
    private readonly clerkEnricher: WrapperType<ClerkUserEnricherService>,
    @Inject(CLERK_CLIENT_PROVIDER_TOKEN)
    private readonly clerkClient: ClerkClient,
  ) {
    super()
  }

  override onModuleInit() {
    super.onModuleInit()
    this.wrapReadsWithEnrichment()
  }

  findUser(where: Prisma.UserWhereUniqueInput) {
    return this.findUnique({
      where,
    })
  }

  findUserByEmail(email: string) {
    return this.findFirst({
      where: { email: { equals: email, mode: Prisma.QueryMode.insensitive } },
    })
  }

  async findByCampaign(campaign: Campaign) {
    return this.findUser({ id: campaign.userId })
  }

  async findByCustomerId(customerId: string) {
    return this.findFirst({
      where: {
        metaData: {
          path: ['customerId'],
          equals: customerId,
        },
      },
    })
  }

  findUserByResetToken(email: string, token: string) {
    return this.findFirstOrThrow({
      where: {
        email: { equals: email, mode: Prisma.QueryMode.insensitive },
        passwordResetToken: token,
      },
    })
  }

  async updatePassword(
    userId: number,
    password: string,
    clearResetToken?: boolean,
  ) {
    return this.model.update({
      where: { id: userId },
      data: {
        // hash password
        password: await hashPassword(password),
        // clear reset token
        passwordResetToken: clearResetToken ? null : undefined,
      },
    })
  }

  setResetToken(userId: number, passwordResetToken: string) {
    return this.model.update({
      where: { id: userId },
      data: {
        passwordResetToken,
      },
    })
  }

  async createUser(
    userData: WithOptional<CreateUserInputDto, 'password' | 'phone'>,
  ): Promise<User> {
    const { signUpMode, allowTexts, ...restUserData } = userData
    const {
      password,
      firstName,
      lastName,
      zip,
      phone,
      name,
      email: unNormalizedEmail,
    } = restUserData
    const email = toLowerAndTrim(unNormalizedEmail)

    const hashedPassword = password ? await hashPassword(password) : null
    const existingUser = await this.findUserByEmail(email)
    if (existingUser) {
      throw new ConflictException('User with this email already exists')
    }

    const {
      firstName: firstNameTrimmed,
      lastName: lastNameTrimmed,
      ...trimmed
    } = trimMany({
      firstName,
      lastName,
      ...(phone ? { phone } : {}),
      ...(zip ? { zip } : {}),
    })

    const metaData = {
      textNotifications: allowTexts,
    }

    const userDataToPersist = {
      ...restUserData,
      ...trimmed,
      email,
      ...(hashedPassword ? { password: hashedPassword } : {}),
      hasPassword: !!hashedPassword,
      name: name?.trim() || `${firstNameTrimmed} ${lastNameTrimmed}`,
      metaData,
    }

    const user = await this.model.create({
      data: userDataToPersist,
    })

    // We have to await this form post to ensure the user is created in CRM
    //  before we try to update the crm contact with the user id
    await this.crm.submitCrmForm(
      REGISTER_USER_CRM_FORM_ID,
      [
        { name: 'firstName', value: firstName, objectTypeId: '0-1' },
        { name: 'lastName', value: lastName, objectTypeId: '0-1' },
        { name: 'email', value: email, objectTypeId: '0-1' },
        ...(phone
          ? [{ name: 'phone', value: phone, objectTypeId: '0-1' }]
          : []),
        ...(signUpMode
          ? [
              {
                name: 'facilitated_signup',
                value:
                  signUpMode === SIGN_UP_MODE.FACILITATED ? 'true' : 'false',
              },
            ]
          : []),
      ],
      'registerPage',
      'https://goodparty.org/sign-up',
    )

    await this.crm.trackUserUpdate(user.id)

    return user
  }

  // Ties the Clerk-provisioned signup to the visitor's HubSpot web session:
  // a Forms API submission carrying context.hutk is the only way HubSpot
  // grants web/paid original-source attribution to a contact that Segment
  // would otherwise create as "offline sources".
  async submitRegistrationCrmForm(user: User, hutk?: string) {
    const { firstName, lastName, email, phone } = user
    return this.crm.submitCrmForm(
      REGISTER_USER_CRM_FORM_ID,
      [
        ...(firstName
          ? [{ name: 'firstName', value: firstName, objectTypeId: '0-1' }]
          : []),
        ...(lastName
          ? [{ name: 'lastName', value: lastName, objectTypeId: '0-1' }]
          : []),
        { name: 'email', value: email, objectTypeId: '0-1' },
        ...(phone
          ? [{ name: 'phone', value: phone, objectTypeId: '0-1' }]
          : []),
      ],
      'registerPage',
      `${APP_ROOT}/sign-up`,
      hutk,
    )
  }

  async findOrProvisionByClerk(data: {
    clerkId: string
    email: string
    firstName: string
    lastName: string
  }): Promise<User | null> {
    const existingByClerkId = await this.findUser({
      clerkId: data.clerkId,
    })
    if (existingByClerkId) return existingByClerkId

    const existingByEmail = await this.findUserByEmail(data.email)
    if (existingByEmail) {
      // A concurrent provision of the same Clerk user may have created the
      // row between our two lookups — same clerkId is a match, not a rebind.
      if (existingByEmail.clerkId === data.clerkId) {
        return existingByEmail
      }
      if (existingByEmail.clerkId) {
        this.logger.warn(
          {
            userId: existingByEmail.id,
            existingClerkId: existingByEmail.clerkId,
            incomingClerkId: data.clerkId,
          },
          'Refused clerkId rebind: user already has a Clerk identity',
        )
        return null
      }
      return this.tryBindClerkId(existingByEmail.id, data.clerkId)
    }

    try {
      const user = await this.model.create({
        data: {
          clerkId: data.clerkId,
          email: toLowerAndTrim(data.email),
          firstName: data.firstName,
          lastName: data.lastName,
          name: `${data.firstName} ${data.lastName}`.trim(),
        },
      })
      this.logger.info(
        { userId: user.id, clerkId: data.clerkId },
        'Created new user from Clerk',
      )
      return user
    } catch (err) {
      if (isPrismaError(err, 'P2002')) {
        return this.resolveAfterP2002(data)
      }
      throw err
    }
  }

  private async tryBindClerkId(
    userId: number,
    clerkId: string,
  ): Promise<User | null> {
    const updated = await this.model.updateMany({
      where: { id: userId, clerkId: null },
      data: { clerkId },
    })
    if (updated.count === 0) {
      const refetched = await this.findUser({ id: userId })
      if (refetched?.clerkId === clerkId) return refetched
      this.logger.warn(
        { userId, incomingClerkId: clerkId },
        'Refused clerkId rebind: concurrent writer set clerkId first',
      )
      return null
    }
    this.logger.info(
      { userId, clerkId },
      'Linking legacy user to Clerk account',
    )
    return this.findUser({ id: userId })
  }

  private async resolveAfterP2002(data: {
    clerkId: string
    email: string
  }): Promise<User | null> {
    this.logger.debug(
      { clerkId: data.clerkId },
      'Concurrent provisioning detected, fetching existing user',
    )
    const byClerkId = await this.findUser({
      clerkId: data.clerkId,
    })
    if (byClerkId) return byClerkId

    const byEmail = await this.findUserByEmail(data.email)
    if (!byEmail) {
      this.logger.error(
        { clerkId: data.clerkId, email: data.email },
        'P2002 race but user not found by clerkId or email',
      )
      return null
    }
    if (byEmail.clerkId && byEmail.clerkId !== data.clerkId) {
      this.logger.warn(
        {
          userId: byEmail.id,
          existingClerkId: byEmail.clerkId,
          incomingClerkId: data.clerkId,
        },
        'P2002 race: email match has different clerkId, refusing rebind',
      )
      return null
    }
    if (!byEmail.clerkId) {
      return this.tryBindClerkId(byEmail.id, data.clerkId)
    }
    return byEmail
  }

  async updateUser(where: Prisma.UserWhereUniqueInput, data: Partial<User>) {
    return this.optimisticLockingUpdate({ where }, (existing) => {
      const { metaData: incomingMetaData, ...fields } = data
      if (incomingMetaData === undefined) {
        return fields
      }
      return {
        ...fields,
        metaData: {
          ...(existing.metaData ?? {}),
          ...(incomingMetaData ?? {}),
        },
      }
    })
  }

  // Atomic compare-and-swap on the single tracked checkout session id: the
  // write only lands when the stored id still matches what the caller read,
  // so concurrent checkout creations and expiry webhooks can't clobber each
  // other's session tracking. Raw SQL because a conditional single-key JSON
  // update can't be expressed as a Prisma merge.
  async compareAndSwapCheckoutSessionId(
    userId: number,
    expectedSessionId: string | null,
    nextSessionId: string | null,
  ): Promise<boolean> {
    const updatedCount = await this.client.$executeRaw`
      UPDATE "user"
      SET meta_data = jsonb_set(
        COALESCE(meta_data, '{}'::jsonb),
        '{checkoutSessionId}',
        COALESCE(to_jsonb(${nextSessionId}::text), 'null'::jsonb)
      )
      WHERE id = ${userId}
        AND meta_data->>'checkoutSessionId'
          IS NOT DISTINCT FROM ${expectedSessionId}::text
    `
    return updatedCount === 1
  }

  async patchUserMetaData(
    userId: number,
    newMetaData: PrismaJson.UserMetaData,
  ) {
    const updatedUser = await this.optimisticLockingUpdate(
      { where: { id: userId } },
      (user) => {
        this.logger.info(
          { data: user.metaData ?? {} },
          `User ${user.id} metadata pre-update: `,
        )
        return {
          metaData: { ...(user.metaData ?? {}), ...(newMetaData ?? {}) },
        }
      },
    )
    this.logger.info(
      { data: updatedUser.metaData ?? {} },
      `User ${updatedUser.id} metadata post-update: `,
    )

    return updatedUser
  }

  async deleteUser(id: number, initiatedByUserId: number) {
    const user = await this.model.findUnique({
      where: { id },
      include: { campaigns: true },
    })

    const campaign = user?.campaigns?.[0]
    // Prisma JSON column typed as JsonValue — requires prisma-json-types-generator to narrow
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const subscriptionId = (campaign?.details as { subscriptionId?: string })
      ?.subscriptionId

    await this.client.$transaction(async (tx) => {
      await tx.user.delete({ where: { id } })
      this.logger.info({ userId: id }, 'User deleted from database')

      if (user?.clerkId) {
        try {
          await this.clerkClient.users.deleteUser(user.clerkId)
          this.logger.info(
            { userId: id, clerkId: user.clerkId },
            'User deleted from Clerk',
          )
        } catch (error) {
          this.logger.error(
            { error },
            `Failed to delete Clerk user ${user.clerkId} during account deletion`,
          )
          throw new BadGatewayException(
            `Failed to delete Clerk user during account deletion`,
          )
        }
      }
    })

    if (subscriptionId) {
      try {
        await this.stripeService.cancelSubscription(subscriptionId)
      } catch (error) {
        if (
          error instanceof BadGatewayException &&
          error.cause instanceof Stripe.errors.StripeError
        ) {
          const stripeError = error.cause
          this.logger.error(
            {
              data: {
                code: stripeError.code,
                type: stripeError.type,
                statusCode: stripeError.statusCode,
              },
            },
            `Failed to cancel subscription ${subscriptionId} after user deletion: ${stripeError.message}`,
          )
        } else {
          this.logger.error(
            { error },
            `Unexpected error canceling subscription ${subscriptionId} after user deletion`,
          )
        }
      }
    }

    await this.trackUserDeletion(id, initiatedByUserId, user)
  }

  private async trackUserDeletion(
    id: number,
    initiatedByUserId: number,
    user: Prisma.UserGetPayload<{ include: { campaigns: true } }> | null,
  ) {
    const isSelf = initiatedByUserId === id
    // Prisma JSON column typed as JsonValue — requires prisma-json-types-generator to narrow
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const metaData = user?.metaData as PrismaJson.UserMetaData | null
    const userContext = {
      email: user?.email,
      hubspotId: metaData?.hubspotId as string | undefined,
    }
    const trackingEvent = EVENTS.Account.UserDeleted
    const trackingProperties = {
      clerkId: user?.clerkId,
      hadActiveCampaign: (user?.campaigns?.length ?? 0) > 0,
      initiatedBy: isSelf ? 'self' : 'admin',
      ...(!isSelf && { initiatedByUserId }),
    }

    try {
      await this.analytics.track(
        id,
        trackingEvent,
        trackingProperties,
        userContext,
      )
    } catch (error) {
      this.logger.error(
        { error, trackingEvent, trackingProperties },
        'Failed to track user deletion event',
      )
    }
  }

  /** Resolves gp-api Clerk user id by email, or signals email fallback when no user exists. */
  async resolveClerkIdByEmail(email: string): Promise<ResolvedActorIdentity> {
    const result = await this.clerkClient.users.getUserList({
      emailAddress: [email],
      limit: 1,
    })
    const clerkId = result.data[0]?.id
    return clerkId
      ? { source: 'clerk', clerkId }
      : { source: 'email-fallback', email }
  }

  async impersonateUser(userId: number, actorClerkId: string) {
    const user = await this.findUser({ id: userId })
    if (!user?.clerkId) {
      throw new BadRequestException('User does not have an associated Clerk ID')
    }
    try {
      const { token } = await this.clerkClient.actorTokens.create({
        userId: user.clerkId,
        actor: { sub: actorClerkId },
        expiresInSeconds: 3600,
      })
      if (!token) {
        throw new BadGatewayException('Clerk did not return an actor token')
      }
      return { token }
    } catch (err) {
      this.logger.error(
        {
          err,
          userId,
          targetClerkId: user.clerkId,
          actorClerkId,
          clerkStatus:
            err instanceof Error
              ? (err as Error & { status?: unknown }).status
              : undefined,
          clerkErrors:
            err instanceof Error
              ? (err as Error & { errors?: unknown }).errors
              : undefined,
          clerkMessage: err instanceof Error ? err.message : String(err),
        },
        'Failed to create Clerk impersonation token',
      )
      throw new BadGatewayException('Failed to create impersonation token')
    }
  }

  /**
   * Provisions a passwordless Clerk identity + local user for a sales-sent EO
   * magic link and mints a single-use sign-in token. Idempotent on email:
   * reuses an existing Clerk user / local user when present, so returning leads
   * don't get a duplicate identity. The token is redeemed by the webapp via
   * Clerk's `ticket` sign-in strategy.
   */
  // A magic-link sign-in may only be minted for a fresh EO lead (or a stranded
  // partial-create), never a real account: any assigned role (admin, sales,
  // candidate, …) or campaign ownership marks a real account and is refused. A
  // new lead and a stranded partial-create both have roles: [] and no campaign,
  // so this never blocks legitimate provisioning (incl. admin retries).
  private async assertReusableForMagicLink(user: User): Promise<void> {
    if (user.roles.length > 0) {
      throw new ConflictException(EXISTING_ACCOUNT_MAGIC_LINK_ERROR)
    }
    const campaignCount = await this.client.campaign.count({
      where: { userId: user.id },
    })
    if (campaignCount > 0) {
      throw new ConflictException(EXISTING_ACCOUNT_MAGIC_LINK_ERROR)
    }
  }

  async provisionMagicLinkUser(data: {
    email: string
    firstName: string
    lastName: string
    expiresInSeconds?: number
  }): Promise<{ user: User; token: string; clerkId: string }> {
    const email = toLowerAndTrim(data.email)

    // Reject the magic link for any account the person actually controls. A
    // password, an OAuth/SSO identity (e.g. Google), a TOTP/2FA authenticator,
    // backup codes, or a linked web3 wallet all mean the person can already
    // authenticate, so reusing the account would hand an admin-initiated sign-in
    // token to someone else. Only a bare passwordless email identity with none
    // of these is reusable.
    const assertReusablePasswordless = async (id: string): Promise<void> => {
      const clerkUser = await this.clerkClient.users.getUser(id)
      const controlsAccount =
        clerkUser.passwordEnabled ||
        clerkUser.totpEnabled ||
        clerkUser.backupCodeEnabled ||
        (clerkUser.externalAccounts?.length ?? 0) > 0 ||
        (clerkUser.web3Wallets?.length ?? 0) > 0
      if (controlsAccount) {
        throw new ConflictException(EXISTING_ACCOUNT_MAGIC_LINK_ERROR)
      }
    }

    // Gate the pre-existing email-matched row BEFORE minting or binding any
    // Clerk identity: otherwise findOrProvisionByClerk would bind the fresh
    // Clerk id onto that row (tryBindClerkId) before we could reject it, leaving
    // a foreign clerkId stamped on e.g. a staff/admin account. Re-checked on the
    // resolved user below to cover a row created concurrently.
    const existingLocal = await this.findUserByEmail(email)
    if (existingLocal) {
      await this.assertReusableForMagicLink(existingLocal)
    }

    let clerkId: string
    const existing = await this.resolveClerkIdByEmail(email)
    if (existing.source === 'clerk') {
      clerkId = existing.clerkId
      await assertReusablePasswordless(clerkId)
    } else {
      try {
        const created = await this.clerkClient.users.createUser({
          emailAddress: [email],
          firstName: data.firstName,
          lastName: data.lastName,
          skipPasswordRequirement: true,
        })
        clerkId = created.id
      } catch (err) {
        // Two concurrent magic-link requests for the same email both miss the
        // lookup above and race on createUser; the loser gets Clerk's 422
        // form_identifier_exists. Re-resolve the identity the winner just
        // created and reuse it (under the same gates) instead of surfacing an
        // unhandled 422.
        const clerkStatus =
          err instanceof Error
            ? (err as Error & { status?: unknown }).status
            : undefined
        const clerkErrors =
          err instanceof Error
            ? (err as Error & { errors?: { code?: string }[] }).errors
            : undefined
        const isDuplicateIdentity =
          clerkStatus === 422 &&
          Array.isArray(clerkErrors) &&
          clerkErrors.some((e) => e?.code === 'form_identifier_exists')
        if (!isDuplicateIdentity) {
          throw err
        }
        const raced = await this.resolveClerkIdByEmail(email)
        if (raced.source !== 'clerk') {
          throw err
        }
        clerkId = raced.clerkId
        await assertReusablePasswordless(clerkId)
      }
    }

    const user = await this.findOrProvisionByClerk({
      clerkId,
      email,
      firstName: data.firstName,
      lastName: data.lastName,
    })
    if (!user) {
      throw new ConflictException(
        'This email is already linked to a different Clerk identity',
      )
    }

    // Checked on the RESOLVED user: findOrProvisionByClerk can return a
    // pre-existing clerkId-null local row matched by email (the takeover
    // target), not only the just-created lead.
    await this.assertReusableForMagicLink(user)

    const signInToken = await this.clerkClient.signInTokens.createSignInToken({
      userId: clerkId,
      // Sales-sent invites are not redeemed immediately — give the lead a week.
      expiresInSeconds: data.expiresInSeconds ?? 60 * 60 * 24 * 7,
    })
    if (!signInToken.token) {
      throw new BadGatewayException('Clerk did not return a sign-in token')
    }

    return { user, token: signInToken.token, clerkId }
  }

  async flushLastVisited(
    userId: number,
    pendingLastVisitedMs: number,
    sessionTimeoutMs: number,
  ) {
    // Update lastVisited to the max of existing and pending; increment sessionCount if a new session
    return this.client.$executeRaw`
      UPDATE "user" u
      SET
        meta_data = jsonb_set(
          jsonb_set(
            COALESCE(u.meta_data, '{}'::jsonb),
            '{lastVisited}',
            to_jsonb(GREATEST(
              COALESCE((u.meta_data->>'lastVisited')::bigint, 0),
              ${pendingLastVisitedMs}::bigint
            )),
            true
          ),
          '{sessionCount}',
          to_jsonb(
            CASE
              WHEN COALESCE((u.meta_data->>'lastVisited')::bigint, 0) + ${sessionTimeoutMs}::bigint < ${pendingLastVisitedMs}::bigint
                THEN COALESCE((u.meta_data->>'sessionCount')::bigint, 0) + 1
              ELSE COALESCE((u.meta_data->>'sessionCount')::bigint, 0)
            END
          ),
          true
        ),
        updated_at = NOW()
      WHERE u.id = ${userId}
    `
  }

  async listUsers({
    offset: skip = DEFAULT_PAGINATION_OFFSET,
    limit = DEFAULT_PAGINATION_LIMIT,
    sortBy = DEFAULT_SORT_BY,
    sortOrder = DEFAULT_SORT_ORDER,
    firstName,
    lastName,
    email,
    isPro,
  }: ListUsersPagination): Promise<PaginatedResults<User>> {
    const where: Prisma.UserWhereInput = {
      ...(firstName
        ? {
            firstName: {
              contains: firstName,
              mode: Prisma.QueryMode.insensitive,
            },
          }
        : {}),
      ...(lastName
        ? {
            lastName: {
              contains: lastName,
              mode: Prisma.QueryMode.insensitive,
            },
          }
        : {}),
      ...(email
        ? { email: { contains: email, mode: Prisma.QueryMode.insensitive } }
        : {}),
      ...(isPro === true ? { campaigns: { some: { isPro: true } } } : {}),
      ...(isPro === false ? { campaigns: { none: { isPro: true } } } : {}),
    }

    const data = await this.model.findMany({
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      where,
    })

    return {
      data: await this.clerkEnricher.enrichUsers(data),
      meta: {
        total: await this.model.count({ where }),
        offset: skip,
        limit,
      },
    }
  }

  /**
   * Regularly deletes old e2e test users that were created more than 24 hours
   * ago. Cleans out users from both the postgres db and from Clerk.
   */
  @Cron('0 */6 * * *')
  async deleteTestUsers() {
    try {
      const cutoff = subHours(new Date(), 24)

      // 1. Delete DB users.
      const dbUsers = await this.model.findMany({
        where: {
          email: { endsWith: TEST_USER_DOMAIN },
          createdAt: { lt: cutoff },
        },
        select: { id: true },
      })

      let dbDeleted = 0
      for (const dbUser of dbUsers) {
        try {
          await this.model.delete({ where: { id: dbUser.id } })
          dbDeleted++
          this.logger.info({ userId: dbUser.id }, 'Deleted DB test user')
        } catch (err) {
          this.logger.error(
            { err, userId: dbUser.id },
            'Failed to delete DB test user, skipping',
          )
        }
      }

      // 2. Delete Clerk users. Page through users oldest-first, deleting any
      // on the test domain created before the cutoff. Clerk's SDK has no
      // server-side created-at or email-domain filter, so we filter both
      // client-side and advance `offset` past the users we leave behind each
      // page (non-test users and any failed deletes) while deleted users drop
      // out of the list. This drains the entire backlog across passes rather
      // than only ever inspecting the most recent page — the old `query`
      // search never surfaced the bulk of the backlog.
      const cutoffMs = cutoff.getTime()
      let clerkDeleted = 0
      let offset = 0
      for (;;) {
        const { data: page } = await clerkThrottle(() =>
          this.clerkClient.users.getUserList({
            limit: CLERK_PAGE_SIZE,
            offset,
            orderBy: '+created_at',
          }),
        )
        if (page.length === 0) break

        const toDelete = page.filter(
          (user) =>
            user.createdAt < cutoffMs &&
            user.emailAddresses.some((e) =>
              e.emailAddress.endsWith(TEST_USER_DOMAIN),
            ),
        )

        let deletedThisPage = 0
        for (const clerkUser of toDelete) {
          try {
            await clerkThrottle(() =>
              this.clerkClient.users.deleteUser(clerkUser.id),
            )
            clerkDeleted++
            deletedThisPage++
            this.logger.info(
              { userId: clerkUser.id },
              'Deleted Clerk test user',
            )
          } catch (err) {
            this.logger.error(
              { err, userId: clerkUser.id },
              'Failed to delete Clerk test user, skipping',
            )
          }
        }

        // Oldest-first: once a page holds no users older than the cutoff,
        // every later page is newer too, so there is nothing left to clean up.
        if (!page.some((user) => user.createdAt < cutoffMs)) break
        if (page.length < CLERK_PAGE_SIZE) break
        offset += page.length - deletedThisPage
      }

      this.logger.info(
        { dbDeleted, clerkDeleted },
        'Test user cleanup pass complete',
      )
    } catch (err) {
      this.logger.error({ err }, 'Failed to delete test users')
    }
  }

  private wrapReadsWithEnrichment() {
    const enricher = this.clerkEnricher

    Object.defineProperty(this, 'findUnique', {
      value: async (args: Prisma.UserFindUniqueArgs) => {
        const result = await this.model.findUnique(args)
        return result ? enricher.enrichUser(result) : result
      },
      writable: true,
      configurable: true,
    })

    Object.defineProperty(this, 'findUniqueOrThrow', {
      value: async (args: Prisma.UserFindUniqueOrThrowArgs) => {
        const result = await this.model.findUniqueOrThrow(args)
        return enricher.enrichUser(result)
      },
      writable: true,
      configurable: true,
    })

    Object.defineProperty(this, 'findFirst', {
      value: async (args: Prisma.UserFindFirstArgs) => {
        const result = await this.model.findFirst(args)
        return result ? enricher.enrichUser(result) : result
      },
      writable: true,
      configurable: true,
    })

    Object.defineProperty(this, 'findFirstOrThrow', {
      value: async (args: Prisma.UserFindFirstOrThrowArgs) => {
        const result = await this.model.findFirstOrThrow(args)
        return enricher.enrichUser(result)
      },
      writable: true,
      configurable: true,
    })

    Object.defineProperty(this, 'findMany', {
      value: async (args: Prisma.UserFindManyArgs) => {
        const results = await this.model.findMany(args)
        return enricher.enrichUsers(results)
      },
      writable: true,
      configurable: true,
    })
  }
}
