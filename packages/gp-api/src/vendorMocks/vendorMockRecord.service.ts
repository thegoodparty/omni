import { IS_NON_PROD_DEPLOY } from '@/shared/util/appEnvironment.util'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, VendorMockVendor } from '@/generated/prisma'

const MAX_REQUESTS = 10
const ROUTE_FAIL_KIND = 'route_fail'

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

  // Fail-closed to the known non-prod deploys, 404 rather than 403 so the
  // service doesn't advertise itself in prod. Mirrors TestFixturesController.
  private assertNonProdDeploy() {
    if (!IS_NON_PROD_DEPLOY) {
      throw new NotFoundException()
    }
  }
}
