import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { UsersService } from '@/users/services/users.service'
import { isTestUser, newFixtureUserEmail } from '@/users/util/users.util'
import { CLERK_CLIENT_PROVIDER_TOKEN } from '@/vendors/clerk/providers/clerk-client.provider'
import { clerkThrottle } from '@/vendors/clerk/util/clerkThrottle.util'
import { ClerkClient } from '@clerk/backend'
import {
  DeleteTestFixtureUsersResponse,
  TestFixtureSessionResponse,
  TestFixtureUserResponse,
} from '@goodparty_org/contracts'
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { randomUUID } from 'crypto'
import { addSeconds, formatISO } from 'date-fns'
import { User } from '../../generated/prisma'
import {
  CreateTestFixtureUserInput,
  DeleteTestFixtureUsersInput,
  MintTestFixtureSessionInput,
} from '../schemas/testFixtures.schema'

import {
  DEFAULT_RACE,
  StateTransitionsService,
} from './stateTransitions.service'

const FIXTURE_TOKEN_TTL_SECONDS = 60 * 60

type ProvisionedUser = { user: User; clerkUserId: string; password: string }
type MintedSession = { jwt: string; signInToken: string; expiresAt: string }

@Injectable()
export class TestFixturesService {
  constructor(
    private readonly users: UsersService,
    private readonly campaigns: CampaignsService,
    private readonly transitions: StateTransitionsService,
    private readonly organizations: OrganizationsService,
    @Inject(CLERK_CLIENT_PROVIDER_TOKEN)
    private readonly clerkClient: ClerkClient,
  ) {}

  async createFixtureUser(
    input: CreateTestFixtureUserInput,
  ): Promise<TestFixtureUserResponse> {
    const { user, clerkUserId, password } = await this.provisionUser(input)

    let campaignId: number | undefined
    let electedOfficeId: string | undefined
    let campaignOrgSlug: string | undefined
    let orgSlug: string

    if (input.state === 'serve') {
      const office = await this.transitions.createElectedOffice(
        user,
        input.serve,
      )
      electedOfficeId = office.id
      orgSlug = OrganizationsService.electedOfficeOrgSlug(office.id)
    } else {
      const campaign = await this.transitions.createLaunchedCampaign(
        user,
        input.race,
      )
      campaignId = campaign.id
      orgSlug = OrganizationsService.campaignOrgSlug(campaign.id)

      if (input.state === 'pro-win') {
        await this.campaigns.setIsPro(campaign.id, true, false)
      } else if (input.state === 'serve-won-race') {
        const office = await this.transitions.promoteWonRace(user, campaign)
        electedOfficeId = office.id
        campaignOrgSlug = orgSlug
        orgSlug = OrganizationsService.electedOfficeOrgSlug(office.id)
      }
    }

    const session = await this.mintSession(clerkUserId)

    return {
      state: input.state,
      userId: user.id,
      clerkUserId,
      email: user.email,
      password,
      campaignId,
      electedOfficeId,
      orgSlug,
      campaignOrgSlug,
      sessionToken: session.jwt,
      signInToken: session.signInToken,
      cookies: this.buildCookies(user, session.jwt, orgSlug),
      expiresAt: session.expiresAt,
    }
  }

  async deleteFixtureUsers(
    input: DeleteTestFixtureUsersInput,
  ): Promise<DeleteTestFixtureUsersResponse> {
    const users = await this.users.findMany({
      where: {
        OR: [
          ...(input.userIds?.length ? [{ id: { in: input.userIds } }] : []),
          ...(input.emails?.length ? [{ email: { in: input.emails } }] : []),
        ],
      },
    })

    const nonTest = users.filter((user) => !isTestUser({ email: user.email }))
    if (nonTest.length > 0) {
      throw new ForbiddenException('Test users only')
    }

    for (const user of users) {
      await this.users.deleteUser(user.id, user.id)
    }

    const foundIds = new Set(users.map((user) => user.id))
    const foundEmails = new Set(users.map((user) => user.email.toLowerCase()))
    return {
      deleted: users.map((user) => ({ userId: user.id, email: user.email })),
      notFound: [
        ...(input.userIds ?? []).filter((id) => !foundIds.has(id)),
        ...(input.emails ?? []).filter(
          (email) => !foundEmails.has(email.toLowerCase()),
        ),
      ],
    }
  }

  async mintFixtureSession(
    userId: number,
    input: MintTestFixtureSessionInput,
  ): Promise<TestFixtureSessionResponse> {
    const user = await this.users.findUser({ id: userId })
    if (!user) {
      throw new NotFoundException()
    }
    if (!isTestUser({ email: user.email })) {
      throw new ForbiddenException('Test users only')
    }
    if (!user.clerkId) {
      throw new ConflictException('Fixture user has no Clerk identity')
    }

    const orgs = await this.organizations.findMany({
      where: { ownerId: userId },
    })
    const orgSlug = input.orgSlug
      ? orgs.find((org) => org.slug === input.orgSlug)?.slug
      : (orgs.find((org) => org.slug.startsWith('eo-'))?.slug ?? orgs[0]?.slug)
    if (input.orgSlug && !orgSlug) {
      throw new BadRequestException('orgSlug is not owned by this user')
    }
    if (!orgSlug) {
      throw new ConflictException('Fixture user owns no organization')
    }

    const session = await this.mintSession(user.clerkId)
    return {
      userId: user.id,
      email: user.email,
      sessionToken: session.jwt,
      signInToken: session.signInToken,
      cookies: this.buildCookies(user, session.jwt, orgSlug),
      expiresAt: session.expiresAt,
    }
  }

  private async provisionUser(
    input: CreateTestFixtureUserInput,
  ): Promise<ProvisionedUser> {
    const firstName = input.user?.firstName ?? 'QA'
    const lastName = input.user?.lastName ?? 'Fixture'
    const email = newFixtureUserEmail()
    const password = `Test${randomUUID()}!`

    const clerkUser = await clerkThrottle(() =>
      this.clerkClient.users.createUser({
        emailAddress: [email],
        password,
        firstName,
        lastName,
        skipPasswordChecks: true,
      }),
    )

    const user = await this.users.findOrProvisionByClerk({
      clerkId: clerkUser.id,
      email,
      firstName,
      lastName,
    })
    if (!user) {
      throw new ConflictException(
        'Fixture user provisioning raced an existing account',
      )
    }

    const zip = input.race?.zip ?? DEFAULT_RACE.zip
    const updated = await this.users.updateUser({ id: user.id }, { zip })
    return { user: updated, clerkUserId: clerkUser.id, password }
  }

  private async mintSession(clerkUserId: string): Promise<MintedSession> {
    // gp-webapp pages are gated by the Clerk session, so a browser consumer
    // needs a sign-in ticket to redeem (strategy: 'ticket'); the session JWT
    // below only authenticates direct gp-api calls. Single-use, so every
    // /session re-mint issues a fresh one.
    const signInTokenResponse = await clerkThrottle(() =>
      this.clerkClient.signInTokens.createSignInToken({
        userId: clerkUserId,
        expiresInSeconds: FIXTURE_TOKEN_TTL_SECONDS,
      }),
    )
    if (!signInTokenResponse.token) {
      throw new BadGatewayException('Clerk did not return a sign-in token')
    }
    const signInToken = signInTokenResponse.token
    // Browser-minted Clerk tokens die at 60s; a backend session token minted
    // with an explicit TTL survives a whole QA run (same pattern as the e2e
    // suite's mintApiToken).
    const session = await clerkThrottle(() =>
      this.clerkClient.sessions.createSession({ userId: clerkUserId }),
    )
    const { jwt } = await clerkThrottle(() =>
      this.clerkClient.sessions.getToken(
        session.id,
        undefined,
        FIXTURE_TOKEN_TTL_SECONDS,
      ),
    )
    return {
      jwt,
      signInToken,
      expiresAt: formatISO(addSeconds(new Date(), FIXTURE_TOKEN_TTL_SECONDS)),
    }
  }

  private buildCookies(user: User, token: string, orgSlug: string) {
    return {
      token,
      user: JSON.stringify({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        name: user.name,
        zip: user.zip,
        phone: user.phone,
      }),
      'organization-slug': orgSlug,
    }
  }
}
