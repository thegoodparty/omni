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

export type GoodPartyClientConfig = {
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

  private constructor(gpApiRootUrl: string, getToken: () => Promise<string>) {
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
    const { gpApiRootUrl } = config

    // The OIDC token is read from the current request and rotated by Vercel,
    // so it is fetched for every request and never cached. The import is
    // dynamic because client components reach this file through the
    // '@/shared/gpApi' barrel, and a static import ships jose to the browser.
    const getToken = async (): Promise<string> => {
      try {
        const { getVercelOidcToken } = await import('@vercel/oidc')
        return await getVercelOidcToken()
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        throw new SdkError(
          0,
          `Vercel OIDC token unavailable: ${message}. Locally, run \`vercel link\` and \`vercel env pull\` in packages/gp-admin to write VERCEL_OIDC_TOKEN to .env.local.`
        )
      }
    }

    await getToken()
    return new GoodPartyClient(gpApiRootUrl, getToken)
  }
}
