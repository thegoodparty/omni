import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { Campaign, TcrCompliance, User } from '../../../generated/prisma'
import { format } from '@redtea/format-axios-error'
import { isAxiosError } from 'axios'
import { parsePhoneNumberWithError } from 'libphonenumber-js'
import { AreaCodeFromZipService } from 'src/ai/util/areaCodeFromZip.util'
import { resolveJobGeographyFromAddress } from 'src/outreach/util/campaignGeography.util'
import { P2P_JOB_DEFAULTS } from '../constants/p2pJob.constants'
import {
  BallotReadyPositionLevel,
  PeerlyCvVerificationStatus,
  PinDelivery,
} from '@goodparty_org/contracts'
import { derivePinDelivery } from '../utils/peerlyPinDelivery.util'
import { CampaignsService } from '../../../campaigns/services/campaigns.service'
import { CreateTcrCompliancePayload } from '../../../campaigns/tcrCompliance/campaignTcrCompliance.types'
import { DateFormats, formatDate } from '../../../shared/util/date.util'
import { ensureUrlHasProtocol } from '../../../shared/util/strings.util'
import { getUserFullName } from '../../../users/util/users.util'
import { GooglePlacesService } from '../../google/services/google-places.service'
import { extractAddressComponents } from '../../google/util/GooglePlaces.util'
import { PeerlyBaseConfig } from '../config/peerlyBaseConfig'
import {
  Approve10DLCBrandResponseBody,
  BrandApprovalResult,
  CampaignVerificationStatus,
  Peerly10DlcBrandData,
  Peerly10DLCBrandSubmitResponseBody,
  PeerlyCvVerificationType,
  PeerlyApiErrorContext,
  PeerlyCreateCVTokenResponse,
  PeerlyGetCvRequestResponseBody,
  PeerlyGetIdentitiesResponseBody,
  PeerlyIdentity,
  PeerlyIdentityCreateResponseBody,
  PeerlyIdentityProfileResponseBody,
  PeerlyIdentityUseCaseResponseBody,
  PeerlyRetrieveCampaignVerifyStatusResponseBody,
  PeerlyRetrieveCvResponseBody,
  PeerlySubmitCVResponseBody,
  PeerlyVerifyCVPinResponse,
} from '../peerly.types'
import {
  getPeerlyCommitteeType,
  getPeerlyLocaleFromOfficeLevel,
  PEERLY_ENTITY_TYPE,
  PEERLY_PROFILE_STATUS_FINALIZED,
  PeerlyLocalities,
  PEERLY_USECASE,
} from './peerly.const'
import { SlackService } from '../../slack/services/slack.service'
import { SlackChannel, SlackMessageType } from '../../slack/slackService.types'
import { UsersService } from '../../../users/services/users.service'
import { PeerlyErrorHandlingService } from './peerlyErrorHandling.service'
import { PeerlyHttpService } from './peerlyHttp.service'
import { buildPeerlySlackErrorMessage } from '../utils/buildPeerlySlackErrorMessage.util'
import {
  isPeerlyBillingError,
  PeerlyBillingException,
  PEERLY_NO_PAYMENT_METHOD_MESSAGE,
} from '../utils/peerlyBillingError.util'
import { PinoLogger } from 'nestjs-pino'

@Injectable()
export class PeerlyIdentityService extends PeerlyBaseConfig {
  constructor(
    protected readonly logger: PinoLogger,
    private readonly peerlyHttpService: PeerlyHttpService,
    private readonly peerlyErrorHandling: PeerlyErrorHandlingService,
    private readonly placesService: GooglePlacesService,
    private readonly campaignsService: CampaignsService,
    private readonly areaCodeFromZipService: AreaCodeFromZipService,
    private readonly slackService: SlackService,
    private readonly usersService: UsersService,
  ) {
    super(logger)
  }

  getTCRIdentityName(userFullName: string, campaignEIN: string) {
    return this.isTestEnvironment
      ? `TEST-${userFullName} - ${campaignEIN}`
      : `${userFullName} - ${campaignEIN}`
  }

  async createIdentity(
    identityName: string,
    campaign: Campaign,
  ): Promise<PeerlyIdentity | undefined> {
    this.logger.debug(`Creating identity with name: '${identityName}'`)
    try {
      const response =
        await this.peerlyHttpService.post<PeerlyIdentityCreateResponseBody>(
          '/identities',
          {
            account_id: this.accountNumber,
            identity_name: identityName,
            usecases: [PEERLY_USECASE],
          },
        )
      const { data } = response
      const { Data: identity } = data
      this.logger.debug({ identity }, 'Successfully created identity:')
      return identity
    } catch (error) {
      return await this.handleApiError(error, { campaign })
    }
  }

  async getIdentities(campaign: Campaign): Promise<PeerlyIdentity[]> {
    this.logger.debug('Fetching list of identities from Peerly')
    let result: PeerlyIdentity[] = []
    try {
      const response =
        await this.peerlyHttpService.get<PeerlyGetIdentitiesResponseBody>(
          '/identities/listByAccount',
          { params: { account_id: this.accountNumber } },
        )
      const { data } = response
      const { identities } = data
      this.logger.debug(
        { data: identities.map((identity) => identity.identity_name) },
        `Successfully fetched ${identities.length} identities: `,
      )
      result = identities
    } catch (error) {
      await this.handleApiError(error, { campaign })
    }
    return result
  }

  async getIdentityUseCases(peerlyIdentityId: string, campaign: Campaign) {
    try {
      const response =
        await this.peerlyHttpService.get<PeerlyIdentityUseCaseResponseBody>(
          `/v2/tdlc/${peerlyIdentityId}/get_usecases`,
        )
      const { data: useCases } = response
      this.logger.debug(
        { useCases },
        `Successfully fetched use cases for identityId: ${peerlyIdentityId}: `,
      )
      return useCases
    } catch (e) {
      if (isAxiosError(e) && e.status === 404) {
        this.logger.warn(
          format(e),
          `Peerly API returned 404 Not Found when fetching use cases. This is likely due to an invalid identity ID: ${peerlyIdentityId}`,
        )
        throw new NotFoundException(
          'Use cases for given identity ID could not be found',
        )
      }
      return await this.handleApiError(e, { campaign, peerlyIdentityId })
    }
  }

  async submitIdentityProfile(
    peerlyIdentityId: string,
    campaign: Campaign,
  ): Promise<PeerlyIdentityProfileResponseBody | null> {
    let result: PeerlyIdentityProfileResponseBody | null = null
    try {
      const response =
        await this.peerlyHttpService.post<PeerlyIdentityProfileResponseBody>(
          `/identities/${peerlyIdentityId}/submitProfile`,
          {
            entityType: PEERLY_ENTITY_TYPE,
            is_political: true,
          },
        )
      const { data } = response
      this.logger.debug({ data }, 'Successfully submitted identity profile:')
      result = data
    } catch (error) {
      await this.handleApiError(error, { campaign, peerlyIdentityId })
    }
    return result
  }

  async getIdentityProfile(
    peerlyIdentityId: string,
    campaign: Campaign,
    options?: { suppressSlackAlert?: boolean },
  ): Promise<PeerlyIdentityProfileResponseBody | null> {
    this.logger.debug(
      `Fetching identity profile for identityId: ${peerlyIdentityId}`,
    )
    let result: PeerlyIdentityProfileResponseBody | null = null
    try {
      const response =
        await this.peerlyHttpService.get<PeerlyIdentityProfileResponseBody>(
          `/identities/${peerlyIdentityId}/getProfile`,
        )
      const { data } = response
      this.logger.debug(
        { data },
        `Successfully fetched identity profile for identityId: ${peerlyIdentityId}: `,
      )
      result = data || null
    } catch (e) {
      if (isAxiosError(e) && e.status === 404) {
        this.logger.warn(
          format(e),
          `Peerly API returned 404 Not Found when fetching identity profile. This is likely due to an invalid identity ID: ${peerlyIdentityId}`,
        )
        throw new NotFoundException(
          'Identity profile for given identity ID could not be found',
        )
      }
      await this.handleApiError(e, {
        campaign,
        peerlyIdentityId,
        suppressSlackAlert: options?.suppressSlackAlert,
      })
    }
    return result
  }

  async submit10DlcBrand(
    peerlyIdentityId: string,
    tcrCompliancePayload: CreateTcrCompliancePayload,
    campaign: Campaign,
    domainName: string,
  ) {
    const { details: campaignDetails, placeId } = campaign
    const { phone, websiteDomain, ein } = tcrCompliancePayload
    const { street, city, state, postalCode } = extractAddressComponents(
      // TODO(ENG-6400): using `placeId!` is dangerous here.
      await this.placesService.getAddressByPlaceId(placeId!),
    )
    const { campaignCommittee } = campaignDetails
    if (!campaignCommittee) {
      throw new BadRequestException(
        'Campaign committee is required to submit 10DLC brand',
      )
    }
    const campaignCommitteeName = (
      this.isTestEnvironment ? `TEST-${campaignCommittee}` : campaignCommittee
    ).substring(0, 255) // Limit to 255 characters per Peerly API docs

    const geography = await resolveJobGeographyFromAddress(
      {
        stateCode: state?.short_name?.trim(),
        postalCodeValue: postalCode?.long_name ?? '',
      },
      { areaCodeFromZipService: this.areaCodeFromZipService },
    )

    const submitBrandData: Peerly10DlcBrandData = {
      entityType: PEERLY_ENTITY_TYPE,
      vertical: PEERLY_USECASE,
      is_political: true,
      displayName: campaignCommitteeName,
      companyName: campaignCommitteeName,
      ein,
      phone: parsePhoneNumberWithError(phone, 'US').number,
      street: street?.substring(0, 100), // Limit to 100 characters per Peerly API docs
      city: city?.long_name?.substring(0, 100), // Limit to 100 characters per Peerly API docs
      state: state?.short_name,
      postalCode: postalCode?.long_name,
      website: websiteDomain.substring(0, 100), // Limit to 100 characters per Peerly API docs
      email: `info@${domainName}`.substring(0, 100), // Limit to 100 characters per Peerly API docs
      ...(geography.didState !== P2P_JOB_DEFAULTS.DID_STATE
        ? {
            // Peerly requires didNpaSubset on every jobAreas object even when
            // empty; omitting it leaves the registration unable to load and
            // finalize. An empty array is accepted and lets Peerly pick any
            // area code within the state.
            jobAreas: [
              {
                didState: geography.didState,
                didNpaSubset: geography.didNpaSubset,
              },
            ],
          }
        : {}),
    }

    this.logger.debug({ submitBrandData }, 'Submitting 10DLC brand with data:')
    try {
      const response =
        await this.peerlyHttpService.post<Peerly10DLCBrandSubmitResponseBody>(
          `/v2/tdlc/${peerlyIdentityId}/submit`,
          submitBrandData,
        )
      const { data } = response
      const { submission_key: submissionKey } = data
      this.logger.debug({ data }, 'Successfully submitted 10DLC brand:')
      return submissionKey
    } catch (error) {
      return await this.handleApiError(error, { campaign, peerlyIdentityId })
    }
  }

  async approve10DLCBrand(
    { committeeName, peerlyIdentityId, campaignId }: TcrCompliance,
    campaignVerifyToken: string,
  ): Promise<BrandApprovalResult | undefined> {
    // Approving with an empty token finalizes the brand WITHOUT a Campaign
    // Verify token, which strands it in Peerly's MNO review queue (they must
    // clear it by hand). This was the original ENG-7508 failure mode; refuse
    // it here so no caller can reintroduce a no-token finalization.
    if (!campaignVerifyToken) {
      throw new BadRequestException(
        'Cannot approve a 10DLC brand without a Campaign Verify token',
      )
    }
    const campaign = await this.campaignsService.findFirstOrThrow({
      where: {
        id: campaignId,
      },
    })
    const data = {
      campaign_verify_token: campaignVerifyToken,
      entity_type: PEERLY_ENTITY_TYPE,
      usecase: PEERLY_USECASE,
      sample1: `Hello {first_name}, this is Jack, a volunteer from ${committeeName}. We need your support in the upcoming election. Every vote will count, please reply and let me know if you will need any help. Reply STOP to opt-out`,
      sample2: `Hello {first_name}, this is Jill, a volunteer from ${committeeName}. We're looking for volunteers for some canvassing this coming weekend and I was wondering if you may be interested? Reply STOP to opt-out`,
    }
    try {
      this.logger.debug({ data }, 'Approving 10DLC brand with data:')
      const response =
        await this.peerlyHttpService.post<Approve10DLCBrandResponseBody>(
          `/v2/tdlc/${peerlyIdentityId}/approve`,
          data,
        )

      const {
        data: { campaign_verify_token: _campaignVerifyToken, ...identityBrand },
      } = response
      this.logger.debug(`Successfully approved 10DLC Brand: ${identityBrand}`)

      return identityBrand
    } catch (error) {
      return await this.handleApiError(error, {
        campaign,
        ...(peerlyIdentityId ? { peerlyIdentityId } : {}),
      })
    }
  }

  // Attach a CV token to the 10DLC brand and finalize it so it queues for MNO
  // review (the MNOs are what flip the usecase to activated). For a first-time
  // (`pending`) registration /approve submits it; a brand approved earlier
  // without a CV token is already `finalized` and /approve 400s on it, so
  // /submit first re-opens it to `pending` and attaches the token. /approve
  // only emails the finalization link, so we then call /finalize to confirm it
  // programmatically — otherwise the brand sits at `waiting_to_finalize` until
  // someone clicks that email and never reaches the MNOs.
  async submitCampaignVerifyTokenToBrand(
    tcrCompliance: TcrCompliance,
    campaignVerifyToken: string,
  ): Promise<BrandApprovalResult | undefined> {
    const { peerlyIdentityId, campaignId } = tcrCompliance
    if (!peerlyIdentityId) {
      return this.approve10DLCBrand(tcrCompliance, campaignVerifyToken)
    }
    const campaign = await this.campaignsService.findFirstOrThrow({
      where: { id: campaignId },
    })
    let profileStatus: string | undefined
    try {
      const profile = await this.getIdentityProfile(
        peerlyIdentityId,
        campaign,
        {
          suppressSlackAlert: true,
        },
      )
      profileStatus = profile?.profile?.status
    } catch (error) {
      // A missing/orphaned identity 404s here; fall through to approve, which
      // surfaces the real error. Anything else is unexpected — rethrow.
      if (!(error instanceof NotFoundException)) {
        throw error
      }
    }
    if (profileStatus === PEERLY_PROFILE_STATUS_FINALIZED) {
      await this.submitCvTokenToFinalizedBrand(
        peerlyIdentityId,
        campaignVerifyToken,
        campaign,
      )
    }
    const brand = await this.approve10DLCBrand(
      tcrCompliance,
      campaignVerifyToken,
    )
    await this.finalizeBrand(peerlyIdentityId, campaign)
    return brand
  }

  // Re-opens a finalized brand to `pending` and attaches the CV token. The
  // caller must then /approve to finalize — /submit alone does not queue MNO
  // review.
  private async submitCvTokenToFinalizedBrand(
    peerlyIdentityId: string,
    campaignVerifyToken: string,
    campaign: Campaign,
  ): Promise<void> {
    try {
      await this.peerlyHttpService.post<Peerly10DLCBrandSubmitResponseBody>(
        `/v2/tdlc/${peerlyIdentityId}/submit`,
        { campaign_verify_token: campaignVerifyToken },
      )
    } catch (error) {
      await this.handleApiError(error, { campaign, peerlyIdentityId })
    }
  }

  // /approve only sends the finalization email; this confirms it directly so
  // the registration advances to MNO review without a manual email click.
  // Best-effort: a transient failure here must not surface as a full failure —
  // /approve already advanced the brand past `pending` (so the caller can't
  // retry from scratch — /approve 400s) and the emailed link still finalizes as
  // a fallback.
  private async finalizeBrand(
    peerlyIdentityId: string,
    campaign: Campaign,
  ): Promise<void> {
    try {
      await this.peerlyHttpService.get<string>(
        `/v2/tdlc/${peerlyIdentityId}/finalize`,
      )
    } catch (error) {
      // handleApiError logs + alerts, then always throws; swallow the throw so
      // the best-effort finalize doesn't fail the whole operation.
      await this.handleApiError(error, {
        campaign,
        peerlyIdentityId,
      }).catch(() => undefined)
    }
  }

  async getCampaignVerifyRequest(
    peerlyIdentityId: string,
    campaign: Campaign,
  ): Promise<PeerlyGetCvRequestResponseBody | null> {
    this.logger.debug(
      `Fetching Campaign Verify status for identityId: ${peerlyIdentityId}`,
    )
    let result: PeerlyGetCvRequestResponseBody | null = null
    try {
      const response =
        await this.peerlyHttpService.get<PeerlyGetCvRequestResponseBody>(
          `/v2/tdlc/${peerlyIdentityId}/retrieve_cv`,
        )
      const { data } = response
      this.logger.debug(
        { data },
        `Successfully fetched Campaign Verify status for identityId: ${peerlyIdentityId}: `,
      )
      result = data
    } catch (e) {
      if (isAxiosError<{ status_code?: number }>(e)) {
        // Peerly returns 400 with nested status_code: 404 when CV doesn't exist
        const is404 =
          e.status === 404 ||
          (e.status === 400 && e.response?.data?.status_code === 404)

        if (is404) {
          this.logger.debug(
            `No Campaign Verify request found for identityId: ${peerlyIdentityId} (first-time registration)`,
          )
          return null
        }
      }
      await this.handleApiError(e, { campaign, peerlyIdentityId })
    }
    return result
  }

  async submitCampaignVerifyRequest(
    {
      email,
      ein,
      phone,
      peerlyIdentityId,
      filingUrl,
      officeLevel,
      fecCommitteeId,
      committeeType,
    }: Pick<
      TcrCompliance,
      | 'ein'
      | 'phone'
      | 'peerlyIdentityId'
      | 'filingUrl'
      | 'email'
      | 'officeLevel'
      | 'fecCommitteeId'
      | 'committeeType'
    >,
    user: User,
    campaign: Campaign,
    domainName: string,
  ): Promise<PeerlySubmitCVResponseBody | null> {
    const { details: campaignDetails, placeId } = campaign
    const { electionDate, ballotLevel } = campaignDetails

    if (!electionDate) {
      throw new BadRequestException(
        'Campaign must have electionDate to submit CV request',
      )
    }

    const {
      street: filingAddressLine1,
      city,
      state,
      county,
      postalCode,
    } = extractAddressComponents(
      // TODO(ENG-6400): using `placeId!` is dangerous here.
      await this.placesService.getAddressByPlaceId(placeId!),
    )

    // Map officeLevel to Peerly locality
    const peerlyLocale = getPeerlyLocaleFromOfficeLevel(officeLevel)

    const verificationType =
      peerlyLocale === PeerlyLocalities.federal
        ? PeerlyCvVerificationType.Federal
        : PeerlyCvVerificationType.StateLocal

    const isFederal = peerlyLocale === PeerlyLocalities.federal
    const isLocal = peerlyLocale === PeerlyLocalities.local

    // Validate required federal fields
    if (isFederal) {
      if (!fecCommitteeId) {
        this.logger.error(
          `[Campaign Verify] Missing fec_committee_id for federal submission (campaignId=${campaign.id}). ` +
            `This field is required by Peerly for federal verification.`,
        )
        throw new BadRequestException(
          `FEC Committee ID is required for federal candidates.`,
        )
      }
    }

    let cityCounty: string | undefined
    if (isLocal) {
      cityCounty =
        // If it's a county, let's try to use the county name, else, use the city name.
        ballotLevel === BallotReadyPositionLevel.COUNTY
          ? (county?.long_name ?? city?.long_name)
          : city?.long_name

      if (!cityCounty) {
        this.logger.error(
          `[Campaign Verify] Missing city_county for local submission (campaignId=${campaign.id}, placeId=${placeId}). ` +
            `ballotLevel=${ballotLevel}, city=${city?.long_name}, county=${county?.long_name}. ` +
            `This field is required by Peerly when locality is 'local'.`,
        )
        throw new BadRequestException(
          `City or county name is required for local candidates but not present for placeId=${placeId}.`,
        )
      }
    }

    const submitCVData = {
      name: this.isTestEnvironment
        ? `TEST-${getUserFullName(user)}`
        : getUserFullName(user),
      general_campaign_email: email,
      verification_type: verificationType,
      filing_url: ensureUrlHasProtocol(filingUrl),
      // Map Prisma enum to Peerly API values
      committee_type: getPeerlyCommitteeType(committeeType),
      committee_ein: ein,
      election_date: formatDate(new Date(electionDate), DateFormats.isoDate),
      filing_address_line1: filingAddressLine1,
      filing_city: city?.long_name,
      filing_state: state?.short_name,
      filing_zip: postalCode?.long_name,
      filing_email: email,
      verification_method: 'email',
      filing_url_instructions:
        "Deliver the PIN using the first contact information that matches the candidate's election filing, in the following order: email, text, phone call, then postal mail. If the filing is not publicly available, contact the election authority.",
      locality: peerlyLocale,
      // Peerly/CV can actually tell themselves if it's a landline or a cell message.
      // James from Peerly recommended we send this to cell to have a chance of text messages going through.
      filing_phone_type: 'cell',
      filing_phone_number: phone,
      state: state?.short_name,
      campaign_website: domainName ? `https://${domainName}` : undefined,
      // Federal-specific fields
      ...(isFederal
        ? {
            fec_committee_id: fecCommitteeId,
          }
        : {}),
      // Local-specific fields
      ...(isLocal ? { city_county: cityCounty } : {}),
    }

    let result: PeerlySubmitCVResponseBody | null = null
    try {
      this.logger.debug({ submitCVData }, 'Submitting CV request with data:')
      const response =
        await this.peerlyHttpService.post<PeerlySubmitCVResponseBody>(
          `/v2/tdlc/${peerlyIdentityId}/submit_cv`,
          submitCVData,
        )
      const { data } = response
      this.logger.debug(`Successfully submitted CV request: ${data}`)
      result = data
    } catch (error) {
      // Peerly-side billing outage ("No payment method available"): retrying
      // re-fails deterministically and spams Peerly, so fire a distinct,
      // actionable alert and throw a marker the agentic caller uses to persist
      // a hold instead of storming re-submissions.
      if (isPeerlyBillingError(error)) {
        // A Slack failure must not prevent the PeerlyBillingException below —
        // that exception is what makes the caller persist the retry-storm hold.
        await this.alertPeerlyBillingFailure(campaign, peerlyIdentityId).catch(
          (alertErr: unknown) =>
            this.logger.error(
              { alertErr },
              'Failed to send Peerly billing failure alert to Slack',
            ),
        )
        throw new PeerlyBillingException(
          'Peerly Campaign Verify submission failed: ' +
            `"${PEERLY_NO_PAYMENT_METHOD_MESSAGE}" (Peerly billing/account ` +
            'issue). Holding retries until Peerly billing is resolved.',
          { cause: error },
        )
      }
      await this.handleApiError(error, {
        campaign,
        ...(peerlyIdentityId ? { peerlyIdentityId } : {}),
      })
    }
    return result
  }

  // Distinct from the generic Peerly error alert: a billing outage blocks every
  // candidate's PIN, so it needs a recognizable, actionable Slack message on
  // the 10DLC channel rather than being buried among per-identity error noise.
  private async alertPeerlyBillingFailure(
    campaign: Campaign,
    peerlyIdentityId?: string | null,
  ): Promise<void> {
    const user = await this.usersService.findByCampaign(campaign)
    const candidate = user
      ? `${getUserFullName(user)} (${user.email})`
      : `campaignId=${campaign.id}`
    const blocks = [
      {
        type: SlackMessageType.HEADER,
        text: {
          type: SlackMessageType.PLAIN_TEXT,
          text: '💳 Peerly billing failure — 10DLC registrations blocked',
          emoji: true,
        },
      },
      {
        type: SlackMessageType.SECTION,
        text: {
          type: SlackMessageType.MRKDWN,
          text:
            `Peerly returned *"${PEERLY_NO_PAYMENT_METHOD_MESSAGE}"* for a ` +
            'Campaign Verify submission — a billing/account issue on ' +
            "Peerly's side. New 10DLC registrations will keep failing until " +
            `it is resolved.\n*Candidate:* ${candidate}\n` +
            `*Peerly identity:* ${peerlyIdentityId ?? 'N/A'}`,
        },
      },
    ]
    await this.slackService.message({ blocks }, SlackChannel.bot10DlcCompliance)
  }

  async retrieveCampaignVerifyStatus(
    peerlyIdentityId: string,
    campaign: Campaign,
  ) {
    try {
      this.logger.debug(
        `Retrieving campaign verify status for identityId: ${peerlyIdentityId}`,
      )
      const response =
        await this.peerlyHttpService.get<PeerlyRetrieveCampaignVerifyStatusResponseBody>(
          `/v2/tdlc/${peerlyIdentityId}/retrieve_cv`,
        )
      const { data } = response
      const { verification_status: verificationStatus } = data
      this.logger.debug(
        { data },
        'Successfully retrieved campaign verify status:',
      )
      return verificationStatus
    } catch (e) {
      if (isAxiosError<{ status_code?: number }>(e)) {
        // Peerly returns 400 with nested status_code: 404 when no CV request
        // exists for this identity (mirrors getCampaignVerifyRequest). Treat as
        // "no status" rather than alerting + throwing — callers handle null.
        const is404 =
          e.status === 404 ||
          (e.status === 400 && e.response?.data?.status_code === 404)
        if (is404) {
          this.logger.debug(
            `No Campaign Verify request found for identityId: ${peerlyIdentityId}`,
          )
          return null
        }
      }
      return await this.handleApiError(e, { campaign, peerlyIdentityId })
    }
  }

  // Like retrieveCampaignVerifyStatus, but also parses the enriched retrieve_cv
  // payload into the PIN delivery channel + destination Peerly used (present
  // only once the PIN is sent). One Peerly call serves both the live FE display
  // and the detection sweep. Same 404-as-null handling as the status read.
  async retrieveCampaignVerifyDetails(
    peerlyIdentityId: string,
    campaign: Campaign,
  ): Promise<{
    status: PeerlyCvVerificationStatus | null
    pinDelivery: PinDelivery | null
  }> {
    try {
      const response =
        await this.peerlyHttpService.get<PeerlyRetrieveCvResponseBody>(
          `/v2/tdlc/${peerlyIdentityId}/retrieve_cv`,
        )
      const { data } = response
      return {
        status: data.verification_status ?? null,
        pinDelivery: derivePinDelivery(data.verification_data),
      }
    } catch (e) {
      if (isAxiosError<{ status_code?: number }>(e)) {
        const is404 =
          e.status === 404 ||
          (e.status === 400 && e.response?.data?.status_code === 404)
        if (is404) {
          return { status: null, pinDelivery: null }
        }
      }
      return await this.handleApiError(e, { campaign, peerlyIdentityId })
    }
  }

  async verifyCampaignVerifyPin(
    peerlyIdentityId: string,
    pin: string,
    campaign: Campaign,
  ) {
    try {
      const response =
        await this.peerlyHttpService.post<PeerlyVerifyCVPinResponse>(
          `/v2/tdlc/${peerlyIdentityId}/verify_pin`,
          { code: pin },
        )
      const { data } = response
      const { cv_verification_status: cvVerificationStatus } = data
      return cvVerificationStatus === CampaignVerificationStatus.VERIFIED
    } catch (e) {
      if (isAxiosError(e) && e.status === 400) {
        this.logger.warn(
          format(e),
          'Peerly API returned 400 Bad Request when verifying CV PIN. This is likely due to an invalid PIN. ',
        )
        // throw new UnprocessableEntityException('PIN could not be validated')
        return await this.handleApiError(e, {
          campaign,
          peerlyIdentityId,
          httpExceptionClass: UnprocessableEntityException,
        })
      } else {
        return await this.handleApiError(e, { campaign, peerlyIdentityId })
      }
    }
  }

  async createCampaignVerifyToken(
    peerlyIdentityId: string,
    campaign: Campaign,
  ) {
    try {
      this.logger.debug(
        `Creating campaign verify token for identityId: ${peerlyIdentityId}`,
      )
      const response =
        await this.peerlyHttpService.post<PeerlyCreateCVTokenResponse>(
          `/v2/tdlc/${peerlyIdentityId}/create_cv_token`,
        )
      const { data } = response
      const { campaign_verify_token: campaignVerifyToken } = data
      return campaignVerifyToken
    } catch (e) {
      return await this.handleApiError(e, { campaign, peerlyIdentityId })
    }
  }

  private async handleApiError(
    error: unknown,
    context: PeerlyApiErrorContext,
  ): Promise<never> {
    if (context.campaign && !context.suppressSlackAlert) {
      const user = await this.usersService.findByCampaign(context.campaign)
      if (user) {
        const formattedError = (isAxiosError(error) && format(error)) || error
        await this.sendSlackErrorNotification(
          formattedError,
          user,
          context.peerlyIdentityId,
        )
      }
    }
    return this.peerlyErrorHandling.handleApiError({
      error,
      context,
      logger: this.logger,
    })
  }

  private async sendSlackErrorNotification(
    formattedError: unknown,
    user: User,
    peerlyIdentityId?: string,
  ) {
    const errorString =
      typeof formattedError === 'string'
        ? formattedError
        : JSON.stringify(formattedError)

    const blocks = buildPeerlySlackErrorMessage({
      user,
      formattedError: errorString,
      peerlyIdentityId,
    })

    await this.slackService.message({ blocks }, SlackChannel.bot10DlcCompliance)
  }
}
