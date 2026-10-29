import { afterEach, describe, expect, it, vi } from 'vitest'
import { Campaign, VendorMockVendor } from '@/generated/prisma'
import { useTestService } from '@/test-service'
import {
  PEERLY_10DLC_KIND,
  VendorMockRecordService,
} from '@/vendorMocks/vendorMockRecord.service'
import { PeerlyBaseConfig } from '../config/peerlyBaseConfig'
import { PeerlyIdentityService } from './peerlyIdentity.service'
import { useAppEnvOverrides } from '@/shared/test-utils/appEnvOverrides'

// The mock's record writes are gated on a non-prod deploy; the test env isn't.
useAppEnvOverrides({ IS_NON_PROD_DEPLOY: true })

const service = useTestService()

const IDENTITY_ID = 'mock-mode-routing-identity'

// The test app listens on a random port, while vendorBaseUrl points at
// SELF_BASE_URL (localhost:3000), so the one thing this test substitutes is
// the port. Everything else, the /token-auth JWT handshake and the
// `Authorization: JWT` header the 10DLC mock verifies, is the real client.
describe('PeerlyIdentityService in mock mode', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await service.app
      .get(VendorMockRecordService)
      .model.deleteMany({ where: { externalId: IDENTITY_ID } })
  })

  it('getIdentities reaches the Peerly mock instead of the network', async () => {
    const records = service.app.get(VendorMockRecordService)
    await records.upsert(
      VendorMockVendor.peerly,
      PEERLY_10DLC_KIND.identity,
      IDENTITY_ID,
      {
        identity_id: IDENTITY_ID,
        identity_name: 'Routed through the mock',
        start_date: '2026-01-01',
        account_id: '12345678',
        tcr_identity_status: null,
      },
    )
    vi.spyOn(PeerlyBaseConfig.prototype, 'baseUrl', 'get').mockReturnValue(
      `${String(service.client.defaults.baseURL)}/v1/vendor-mocks/peerly`,
    )

    const identities = await service.app
      .get(PeerlyIdentityService)
      .getIdentities({ id: 1 } as Campaign)

    expect(identities.map((i) => i.identity_id)).toContain(IDENTITY_ID)
  })
})
