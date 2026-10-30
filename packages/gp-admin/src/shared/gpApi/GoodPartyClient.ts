import { HttpClient } from './http/HttpClient'
import { AdminAgentRunsResource } from './resources/AdminAgentRunsResource'
import { EmailOutreachAdminResource } from './resources/EmailOutreachAdminResource'
import { SmsOutreachAdminResource } from './resources/SmsOutreachAdminResource'
import { OutreachResultsAdminResource } from './resources/OutreachResultsAdminResource'
import { PollOutreachAdminResource } from './resources/PollOutreachAdminResource'
import { AdminResource } from './resources/AdminResource'
import { CampaignsResource } from './resources/CampaignsResource'
import { CommunityIssuesResource } from './resources/CommunityIssuesResource'
import { DomainsResource } from './resources/DomainsResource'
import { MeetingBriefingsResource } from './resources/MeetingBriefingsResource'
import { ElectedOfficesResource } from './resources/ElectedOfficesResource'
import { ElectionsResource } from './resources/ElectionsResource'
import { OrganizationsResource } from './resources/OrganizationsResource'
import { PersonProfilesResource } from './resources/PersonProfilesResource'
import { UsersResource } from './resources/UsersResource'
import { SdkError } from './types/result'
import { ClerkService } from './vendor/clerk/clerk.service'

export const GP_API_AUTH_MODE = {
  CLERK: 'clerk',
  OIDC: 'oidc',
} as const

export type GpApiAuthMode =
  (typeof GP_API_AUTH_MODE)[keyof typeof GP_API_AUTH_MODE]

export type GoodPartyClientConfig = {
  authMode: GpApiAuthMode
  m2mSecret?: string
  gpApiRootUrl: string
}

export class GoodPartyClient {
  readonly admin: AdminResource
  readonly adminAgentRuns: AdminAgentRunsResource
  readonly smsOutreachAdmin: SmsOutreachAdminResource
  readonly emailOutreachAdmin: EmailOutreachAdminResource
  readonly outreachResultsAdmin: OutreachResultsAdminResource
  readonly pollOutreachAdmin: PollOutreachAdminResource
  readonly users: UsersResource
  readonly campaigns: CampaignsResource
  readonly electedOffices: ElectedOfficesResource
  readonly elections: ElectionsResource
  readonly organizations: OrganizationsResource
  readonly personProfiles: PersonProfilesResource
  readonly meetingBriefings: MeetingBriefingsResource
  readonly communityIssues: CommunityIssuesResource
  readonly domains: DomainsResource
  private clerkService: ClerkService | null

  private constructor(
    clerkService: ClerkService | null,
    gpApiRootUrl: string,
    getToken: () => Promise<string>
  ) {
    this.clerkService = clerkService
    const httpClient = new HttpClient(gpApiRootUrl, getToken)
    this.admin = new AdminResource(httpClient)
    this.adminAgentRuns = new AdminAgentRunsResource(httpClient)
    this.smsOutreachAdmin = new SmsOutreachAdminResource(httpClient)
    this.emailOutreachAdmin = new EmailOutreachAdminResource(httpClient)
    this.outreachResultsAdmin = new OutreachResultsAdminResource(httpClient)
    this.pollOutreachAdmin = new PollOutreachAdminResource(httpClient)
    this.users = new UsersResource(httpClient)
    this.campaigns = new CampaignsResource(httpClient)
    this.electedOffices = new ElectedOfficesResource(httpClient)
    this.elections = new ElectionsResource(httpClient)
    this.organizations = new OrganizationsResource(httpClient)
    this.personProfiles = new PersonProfilesResource(httpClient)
    this.meetingBriefings = new MeetingBriefingsResource(httpClient)
    this.communityIssues = new CommunityIssuesResource(httpClient)
    this.domains = new DomainsResource(httpClient)
  }

  static create = async (
    config: GoodPartyClientConfig
  ): Promise<GoodPartyClient> => {
    const { authMode, m2mSecret, gpApiRootUrl } = config
    const clerkService = m2mSecret ? new ClerkService(m2mSecret) : null

    const getClerkToken = async (): Promise<string> => {
      if (!clerkService) {
        throw new SdkError(
          0,
          'No machine secret is set for this gp-api environment'
        )
      }
      return clerkService.getToken()
    }

    // The OIDC token is read from the current request and rotated by Vercel,
    // so it is fetched for every request and never cached. The import is
    // dynamic because client components reach this file through the
    // '@/shared/gpApi' barrel, and a static import ships jose to the browser.
    const getOidcToken = async (): Promise<string> => {
      try {
        const { getVercelOidcToken } = await import('@vercel/oidc')
        return await getVercelOidcToken()
      } catch (error: unknown) {
        if (!clerkService) {
          const message =
            error instanceof Error ? error.message : 'Unknown error'
          throw new SdkError(
            0,
            `Vercel OIDC token unavailable and no machine secret is set: ${message}`
          )
        }
        console.warn(
          'Vercel OIDC token unavailable, falling back to the Clerk M2M token'
        )
        return clerkService.getToken()
      }
    }

    const getToken =
      authMode === GP_API_AUTH_MODE.OIDC ? getOidcToken : getClerkToken
    await getToken()
    return new GoodPartyClient(clerkService, gpApiRootUrl, getToken)
  }

  destroy = (): void => {
    this.clerkService?.destroy()
  }
}
