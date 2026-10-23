import { IS_NON_PROD_DEPLOY } from '@/shared/util/appEnvironment.util'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { CALLHUB_VB_STATUS } from '@/vendors/callhub/schemas/callhubCampaign.schema'
import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, VendorMockVendor } from '@/generated/prisma'
import { differenceInSeconds, subSeconds } from 'date-fns'
import {
  VERCEL_ORDER_STATUS,
  VercelOrderStateSchema,
} from '@/vendors/vercel/schemas/vercelMock.schema'

const MAX_REQUESTS = 10
const ROUTE_FAIL_KIND = 'route_fail'
const VERCEL_ORDER_KIND = 'domain_order'
const VERCEL_ORDER_FAIL_KIND = 'order_fail'
export const VERCEL_ORDER_COMPLETION_DELAY_SECONDS = 30

// `vendor_mock_record.kind` values for the Peerly 10DLC mock. externalId is
// the Peerly identity id for every kind, so one identity's records line up.
export const PEERLY_10DLC_KIND = {
  identity: 'identity',
  profile: 'profile',
  brand: 'brand',
  cvRequest: 'cv_request',
  usecase: 'usecase',
} as const

@Injectable()
export class VendorMockRecordService extends createPrismaBase(
  MODELS.VendorMockRecord,
) {
  // Upsert a vendor mock record, appending requestBody to the requests array
  // (capped at MAX_REQUESTS). Write methods are non-prod only — follow the
  // TestFixturesController pattern to fail closed in prod.
  async upsert(
    vendor: VendorMockVendor,
    kind: string,
    externalId: string,
    state: Prisma.InputJsonValue,
    campaignId?: number,
    requestBody?: Prisma.InputJsonValue,
  ) {
    this.assertNonProdDeploy()

    const existing = await this.model.findUnique({
      where: { vendor_kind_externalId: { vendor, kind, externalId } },
    })

    const existingRequests: Prisma.JsonArray = Array.isArray(existing?.requests)
      ? existing.requests
      : []

    const nextRequests: Prisma.InputJsonArray =
      requestBody !== undefined
        ? [...existingRequests, requestBody].slice(-MAX_REQUESTS)
        : [...existingRequests]

    return this.model.upsert({
      where: { vendor_kind_externalId: { vendor, kind, externalId } },
      create: {
        vendor,
        kind,
        externalId,
        state,
        campaignId,
        requests: nextRequests,
      },
      update: {
        state,
        ...(campaignId !== undefined && { campaignId }),
        requests: nextRequests,
      },
    })
  }

  async findByCampaign(campaignId: number) {
    return this.model.findMany({ where: { campaignId } })
  }

  // Returns the vb_campaign mock records for a campaign's robocalls.
  // CallHub records are stored without a campaignId (they're global to the
  // mock controller), so we resolve them via the campaign's OutreachRobocall
  // rows and their callhubCampaignPkStr.
  async findCallhubForCampaign(campaignId: number) {
    const robocalls = await this.client.outreachRobocall.findMany({
      where: { outreach: { campaignId } },
      select: { callhubCampaignPkStr: true },
    })
    const pkStrs = robocalls
      .map((r) => r.callhubCampaignPkStr)
      .filter((pk): pk is string => pk !== null)
    if (pkStrs.length === 0) return []
    const campaigns = await this.model.findMany({
      where: {
        vendor: VendorMockVendor.callhub,
        kind: 'vb_campaign',
        externalId: { in: pkStrs },
      },
    })
    // Include the phonebooks those campaigns were created against.
    const phonebookIds = campaigns.flatMap((c) => {
      const state = c.state
      if (typeof state !== 'object' || state === null || Array.isArray(state)) {
        return []
      }
      const phonebooks: unknown = Object.entries(state).find(
        ([key]) => key === 'phonebooks',
      )?.[1]
      return Array.isArray(phonebooks) ? phonebooks.map(String) : []
    })
    if (phonebookIds.length === 0) return campaigns
    const phonebooks = await this.model.findMany({
      where: {
        vendor: VendorMockVendor.callhub,
        kind: 'phonebook',
        externalId: { in: phonebookIds },
      },
    })
    return [...campaigns, ...phonebooks]
  }

  // Peerly p2p jobs carry no campaignId (the mock controller is global), so
  // they are resolved through the campaign's outreach rows, whose projectId is
  // the Peerly job id.
  async findPeerlyP2pJobsForCampaign(campaignId: number) {
    const outreaches = await this.client.outreach.findMany({
      where: { campaignId, projectId: { not: null } },
      select: { projectId: true },
    })
    const jobIds = outreaches
      .map((o) => o.projectId)
      .filter((id): id is string => id !== null)
    if (jobIds.length === 0) return []
    return this.model.findMany({
      where: {
        vendor: VendorMockVendor.peerly,
        kind: 'p2p_job',
        externalId: { in: jobIds },
      },
    })
  }

  // Moves a mocked Peerly p2p job's send day (`start_date`), which is what the
  // outreach completion sweep reads. Returns false when the job has no record.
  async setPeerlyP2pJobStartDate(jobId: string, startDate: string) {
    this.assertNonProdDeploy()
    const record = await this.model.findUnique({
      where: {
        vendor_kind_externalId: {
          vendor: VendorMockVendor.peerly,
          kind: 'p2p_job',
          externalId: jobId,
        },
      },
    })
    if (!record) return false
    const state =
      typeof record.state === 'object' &&
      record.state !== null &&
      !Array.isArray(record.state)
        ? record.state
        : {}
    await this.model.update({
      where: { id: record.id },
      data: { state: { ...state, start_date: startDate } },
    })
    return true
  }

  // Sets the mocked CallHub voice-broadcast status to END for the campaign's
  // most recent staged or dialing/dialed robocall run.
  async completeCallhubCampaign(campaignId: number) {
    this.assertNonProdDeploy()
    const robocall = await this.client.outreachRobocall.findFirst({
      where: {
        outreach: { campaignId },
        callhubCampaignPkStr: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    })
    if (!robocall?.callhubCampaignPkStr) return
    await this.setFlag(
      VendorMockVendor.callhub,
      'vb_campaign',
      robocall.callhubCampaignPkStr,
      'status',
      CALLHUB_VB_STATUS.END,
    )
  }

  async campaignIdFor(organizationSlug: string | undefined) {
    if (!organizationSlug) return undefined
    const campaign = await this.client.campaign.findUnique({
      where: { organizationSlug },
      select: { id: true },
    })
    return campaign?.id
  }

  // One row per campaign, so a seeded failure only ever reaches that
  // campaign's next route call, never another test's on the same deploy.
  async armRouteFail(campaignId: number) {
    return this.upsert(
      VendorMockVendor.geoapify,
      ROUTE_FAIL_KIND,
      String(campaignId),
      { routeFail: true },
      campaignId,
    )
  }

  // Conditional update so two concurrent route calls can't both consume it.
  async consumeRouteFail(campaignId: number) {
    this.assertNonProdDeploy()
    const { count } = await this.model.updateMany({
      where: {
        vendor: VendorMockVendor.geoapify,
        kind: ROUTE_FAIL_KIND,
        externalId: String(campaignId),
        state: { path: ['routeFail'], equals: true },
      },
      data: { state: { routeFail: false } },
    })
    return count > 0
  }

  // The campaign that owns a candidate domain, via its website. Undefined
  // when no domain row exists (the record is then global, like CallHub's).
  async campaignIdForDomain(domainName: string) {
    const domain = await this.client.domain.findUnique({
      where: { name: domainName },
      select: { website: { select: { campaignId: true } } },
    })
    return domain?.website.campaignId
  }

  async removeVercelProjectDomain(domainName: string) {
    this.assertNonProdDeploy()
    await this.model.deleteMany({
      where: {
        vendor: VendorMockVendor.vercel,
        kind: 'project_domain',
        externalId: domainName,
      },
    })
  }

  // Pending orders read `completed` once the delay has passed since createdAt;
  // completion persists boughtAt so getDomain sees the domain. Failed and
  // completed orders are final.
  async resolveVercelOrder(record: {
    externalId: string
    state: unknown
    createdAt: Date
  }) {
    this.assertNonProdDeploy()
    const state = VercelOrderStateSchema.parse(record.state)
    const due =
      differenceInSeconds(new Date(), record.createdAt) >=
      VERCEL_ORDER_COMPLETION_DELAY_SECONDS
    if (state.status !== VERCEL_ORDER_STATUS.pending || !due) return state
    const completed = {
      ...state,
      status: VERCEL_ORDER_STATUS.completed,
      boughtAt: Date.now(),
    }
    await this.model.update({
      where: {
        vendor_kind_externalId: {
          vendor: VendorMockVendor.vercel,
          kind: VERCEL_ORDER_KIND,
          externalId: record.externalId,
        },
      },
      data: { state: completed },
    })
    return completed
  }

  // Completes the campaign's in-flight orders now instead of after the delay,
  // for a caller that holds the purchase open (the 10DLC fixture). Same state
  // transition as resolveVercelOrder, so getDomain sees the domain as bought.
  // Returns how many orders it completed.
  async completeVercelOrders(campaignId: number) {
    this.assertNonProdDeploy()
    const orders = await this.model.findMany({
      where: {
        vendor: VendorMockVendor.vercel,
        kind: VERCEL_ORDER_KIND,
        campaignId,
      },
    })
    let completed = 0
    for (const record of orders) {
      const state = VercelOrderStateSchema.parse(record.state)
      if (state.status !== VERCEL_ORDER_STATUS.pending) continue
      await this.model.update({
        where: { id: record.id },
        data: {
          state: {
            ...state,
            status: VERCEL_ORDER_STATUS.completed,
            boughtAt: Date.now(),
          },
        },
      })
      completed += 1
    }
    return completed
  }

  // vercel.order.fail: fails the campaign's in-flight orders and arms the
  // campaign's next buy, since the action can land before or after the buy.
  async failVercelOrders(campaignId: number) {
    this.assertNonProdDeploy()
    const pending = await this.model.findMany({
      where: {
        vendor: VendorMockVendor.vercel,
        kind: VERCEL_ORDER_KIND,
        campaignId,
      },
    })
    for (const record of pending) {
      const state = VercelOrderStateSchema.parse(record.state)
      if (state.status !== VERCEL_ORDER_STATUS.pending) continue
      await this.setFlag(
        VendorMockVendor.vercel,
        VERCEL_ORDER_KIND,
        record.externalId,
        'status',
        VERCEL_ORDER_STATUS.failed,
      )
    }
    return this.upsert(
      VendorMockVendor.vercel,
      VERCEL_ORDER_FAIL_KIND,
      String(campaignId),
      { orderFail: true },
      campaignId,
    )
  }

  // Conditional update so two concurrent buys can't both consume it.
  async consumeVercelOrderFail(campaignId: number) {
    this.assertNonProdDeploy()
    const { count } = await this.model.updateMany({
      where: {
        vendor: VendorMockVendor.vercel,
        kind: VERCEL_ORDER_FAIL_KIND,
        externalId: String(campaignId),
        state: { path: ['orderFail'], equals: true },
      },
      data: { state: { orderFail: false } },
    })
    return count > 0
  }

  // Merge { [flag]: value } into the state JSON of a specific record.
  async setFlag(
    vendor: VendorMockVendor,
    kind: string,
    externalId: string,
    flag: string,
    value: Prisma.InputJsonValue,
  ) {
    this.assertNonProdDeploy()

    const record = await this.model.findUniqueOrThrow({
      where: { vendor_kind_externalId: { vendor, kind, externalId } },
    })

    const currentState: Prisma.JsonObject =
      typeof record.state === 'object' &&
      record.state !== null &&
      !Array.isArray(record.state)
        ? record.state
        : {}

    const nextState: Prisma.InputJsonObject = { ...currentState, [flag]: value }

    return this.model.update({
      where: { vendor_kind_externalId: { vendor, kind, externalId } },
      data: { state: nextState },
    })
  }

  // Sets balance to 0 for the Peerly mock by creating a sentinel record.
  // The GET /accounts/:acct/balance endpoint reads this record.
  async emptyPeerlyBalance(campaignId: number) {
    return this.upsert(
      VendorMockVendor.peerly,
      'balance',
      'mock-balance',
      { balance: 0 },
      campaignId,
    )
  }

  // Backdates all peerly phone_list records so checkstatus returns ACTIVE.
  // Called by the p2p.phoneListFinish runJob in E2E specs.
  async finishPeerlyPhoneLists() {
    this.assertNonProdDeploy()
    await this.model.updateMany({
      where: { vendor: VendorMockVendor.peerly, kind: 'phone_list' },
      data: { createdAt: subSeconds(new Date(), 15) },
    })
  }

  async findOne(vendor: VendorMockVendor, kind: string, externalId: string) {
    return this.model.findUnique({
      where: { vendor_kind_externalId: { vendor, kind, externalId } },
    })
  }

  // Merge `patch` into an existing record's state (unlike setFlag, several
  // keys at once) and optionally append a request body. Throws if absent.
  async patchState(
    vendor: VendorMockVendor,
    kind: string,
    externalId: string,
    patch: Prisma.InputJsonObject,
    requestBody?: Prisma.InputJsonValue,
  ) {
    this.assertNonProdDeploy()
    const record = await this.model.findUniqueOrThrow({
      where: { vendor_kind_externalId: { vendor, kind, externalId } },
    })
    const current: Prisma.JsonObject =
      typeof record.state === 'object' &&
      record.state !== null &&
      !Array.isArray(record.state)
        ? record.state
        : {}
    return this.upsert(
      vendor,
      kind,
      externalId,
      { ...current, ...patch },
      undefined,
      requestBody,
    )
  }

  // Delete-then-create, so `createdAt` restarts. Used where a resubmission is
  // a brand-new vendor object whose elapsed-time auto-progress must start over.
  async recreate(
    vendor: VendorMockVendor,
    kind: string,
    externalId: string,
    state: Prisma.InputJsonValue,
    campaignId?: number,
    requestBody?: Prisma.InputJsonValue,
  ) {
    this.assertNonProdDeploy()
    await this.model.deleteMany({ where: { vendor, kind, externalId } })
    return this.upsert(vendor, kind, externalId, state, campaignId, requestBody)
  }

  // The Peerly 10DLC mock links its records to a campaign through the
  // TcrCompliance row, since the Peerly API itself carries no campaign id.
  // Identity ids resolve through TcrCompliance.peerlyIdentityId once the
  // client has saved it; before that (identity create, profile, brand submit)
  // the only link is the EIN, which gp-api puts at the end of the identity
  // name ("<name> - <ein>") and in the brand submit body. Several rows can
  // share an EIN in test data, so the newest one wins.
  async resolvePeerlyCampaignId({
    identityId,
    identityName,
    ein,
  }: {
    identityId?: string
    identityName?: string
    ein?: string
  }): Promise<number | undefined> {
    if (identityId) {
      const linked = await this.client.tcrCompliance.findUnique({
        where: { peerlyIdentityId: identityId },
        select: { campaignId: true },
      })
      if (linked) return linked.campaignId
    }
    const nameSeparator = ' - '
    const nameEin = identityName?.includes(nameSeparator)
      ? identityName.slice(identityName.lastIndexOf(nameSeparator) + 3).trim()
      : undefined
    const lookupEin = ein || nameEin
    if (!lookupEin) return undefined
    const byEin = await this.client.tcrCompliance.findFirst({
      where: { ein: lookupEin },
      orderBy: { createdAt: 'desc' },
      select: { campaignId: true },
    })
    return byEin?.campaignId
  }

  // The identity a campaign's 10DLC control actions act on: the newest
  // identity record linked to it (an orphaned earlier attempt may also exist).
  private async findPeerlyIdentityIdForCampaign(campaignId: number) {
    const identity = await this.model.findFirst({
      where: {
        vendor: VendorMockVendor.peerly,
        kind: PEERLY_10DLC_KIND.identity,
        campaignId,
      },
      orderBy: { createdAt: 'desc' },
    })
    if (identity) return identity.externalId
    const linked = await this.client.tcrCompliance.findUnique({
      where: { campaignId },
      select: { peerlyIdentityId: true },
    })
    if (!linked?.peerlyIdentityId) {
      throw new NotFoundException(
        `No Peerly mock identity for campaign ${campaignId}`,
      )
    }
    return linked.peerlyIdentityId
  }

  async setPeerlyCvStatus(campaignId: number, patch: Prisma.InputJsonObject) {
    const identityId = await this.findPeerlyIdentityIdForCampaign(campaignId)
    return this.requirePatch(
      PEERLY_10DLC_KIND.cvRequest,
      identityId,
      patch,
      'CV request',
    )
  }

  async activatePeerlyUsecase(campaignId: number) {
    const identityId = await this.findPeerlyIdentityIdForCampaign(campaignId)
    return this.requirePatch(
      PEERLY_10DLC_KIND.usecase,
      identityId,
      { status: 'ACTIVE' },
      'use case',
    )
  }

  private async requirePatch(
    kind: string,
    identityId: string,
    patch: Prisma.InputJsonObject,
    label: string,
  ) {
    const existing = await this.findOne(
      VendorMockVendor.peerly,
      kind,
      identityId,
    )
    if (!existing) {
      throw new NotFoundException(
        `No Peerly mock ${label} for identity ${identityId}`,
      )
    }
    return this.patchState(VendorMockVendor.peerly, kind, identityId, patch)
  }

  // Fail-closed to the known non-prod deploys, 404 rather than 403 so the
  // service doesn't advertise itself in prod. Mirrors TestFixturesController.
  private assertNonProdDeploy() {
    if (!IS_NON_PROD_DEPLOY) {
      throw new NotFoundException()
    }
  }
}
