import { HttpStatus } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import { VendorMockVendor } from '@/generated/prisma'
import {
  appEnvOverrides,
  useAppEnvOverrides,
} from '@/shared/test-utils/appEnvOverrides'
import { VendorMockRecordService } from '../vendorMockRecord.service'

useAppEnvOverrides({ IS_NON_PROD_DEPLOY: true, VENDOR_MODE: 'mock' })

const service = useTestService()

const BASE = '/v1/vendor-mocks/scaleToWin'
const CAMPAIGNS = `${BASE}/subaccounts/mock-subaccount/campaigns`
const TEMPLATE_ID = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f'
const AUTH = {
  headers: {
    Authorization: `Basic ${Buffer.from('mock-key-id:mock-key-secret').toString(
      'base64',
    )}`,
  },
}
const CSV = 'firstName,lastName,cellPhone\nA,B,+15555550100\nC,D,+15555550101\n'

const copyCampaign = async () => {
  const res = await service.client.post(
    `${CAMPAIGNS}/${TEMPLATE_ID}/copy`,
    {
      name: 'Panel wave #1',
      contactFields: [],
      scriptVariants: [{ script: 'Hi {{first_name}}' }],
      sendingPhoneNumber: '+16122388359',
    },
    AUTH,
  )
  expect(res.status).toBe(HttpStatus.OK)
  return res.data.id as string
}

const loadContacts = async (campaignId: string, csv = CSV) => {
  const presigned = await service.client.post(
    `${BASE}/uploads/presigned-put`,
    {
      subaccountId: 'mock-subaccount',
      type: 'CONTACT_CSV',
      contentType: 'text/csv',
      fileName: 'wave-1.csv',
    },
    AUTH,
  )
  expect(presigned.status).toBe(HttpStatus.OK)
  const { signedPutUrl, token } = presigned.data
  const path = new URL(signedPutUrl).pathname

  const put = await service.client.put(path, csv, {
    headers: { 'Content-Type': 'text/csv' },
  })
  expect(put.status).toBe(HttpStatus.OK)

  const upload = await service.client.post(
    `${CAMPAIGNS}/${campaignId}/contacts/csv-upload`,
    {
      uploadToken: token,
      estimatedRowCount: 10,
      phoneNumberColumn: 'cellPhone',
      contactFieldMapping: { first_name: 'firstName', last_name: 'lastName' },
    },
    AUTH,
  )
  expect(upload.status).toBe(HttpStatus.OK)
  expect(upload.data).toEqual({ status: 'RUNNING' })
}

describe('Scale to Win mock', () => {
  it('copies a template into a DRAFT campaign', async () => {
    const id = await copyCampaign()

    const res = await service.client.get(`${CAMPAIGNS}/${id}`, AUTH)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toMatchObject({
      id,
      name: 'Panel wave #1',
      status: 'DRAFT',
      sendingPhoneNumber: '+16122388359',
      textingHoursTimezone: null,
    })
  })

  it('reports NOT_RUNNING before any load', async () => {
    const id = await copyCampaign()

    const res = await service.client.get(`${CAMPAIGNS}/${id}/contacts`, AUTH)

    expect(res.data).toEqual({ status: 'NOT_RUNNING' })
  })

  it('loads contacts, counting the uploaded CSV rows', async () => {
    const id = await copyCampaign()
    await loadContacts(id)

    const res = await service.client.get(`${CAMPAIGNS}/${id}/contacts`, AUTH)

    expect(res.data.status).toBe('DONE')
    expect(res.data.result.nContacts).toBe(2)
  })

  it("accepts a CSV over Fastify's 1 MiB default body limit", async () => {
    const id = await copyCampaign()
    const rows = 80_000
    const csv =
      'firstName,lastName,cellPhone\n' + 'A,B,+15555550100\n'.repeat(rows)
    expect(Buffer.byteLength(csv)).toBeGreaterThan(1024 * 1024)

    await loadContacts(id, csv)

    const res = await service.client.get(`${CAMPAIGNS}/${id}/contacts`, AUTH)
    expect(res.data.result.nContacts).toBe(rows)
  })

  it('returns the load counts a test set', async () => {
    const id = await copyCampaign()
    await loadContacts(id)
    const counts = {
      nContacts: 9800,
      nInvalid: 50,
      nDuplicates: 20,
      nOptOuts: 30,
      nNotSubscribed: 0,
      nLandlines: 100,
      nFilteredOut: 0,
      importedFieldNames: ['first_name', 'last_name'],
    }
    await service.app
      .get(VendorMockRecordService)
      .setScaleToWinLoadResult(id, counts)

    const res = await service.client.get(`${CAMPAIGNS}/${id}/contacts`, AUTH)

    expect(res.data).toEqual({ status: 'DONE', error: null, result: counts })
  })

  it('records the load request without the CSV body', async () => {
    const id = await copyCampaign()
    await loadContacts(id)

    const record = await service.app
      .get(VendorMockRecordService)
      .findOne(VendorMockVendor.scale_to_win, 'campaign', id)

    expect(JSON.stringify(record)).not.toContain('+15555550100')
    expect(record?.requests).toContainEqual(
      expect.objectContaining({ route: 'csv-upload', estimatedRowCount: 10 }),
    )
  })

  it('shows a status flip on GET campaign', async () => {
    const id = await copyCampaign()
    await service.app
      .get(VendorMockRecordService)
      .setScaleToWinCampaignStatus(id, 'INITIAL_SEND_COMPLETE')

    const res = await service.client.get(`${CAMPAIGNS}/${id}`, AUTH)

    expect(res.data.status).toBe('INITIAL_SEND_COMPLETE')
  })

  it('starts, then sends the full campaign', async () => {
    const id = await copyCampaign()
    await loadContacts(id)

    const start = await service.client.post(
      `${CAMPAIGNS}/${id}/start`,
      {},
      AUTH,
    )
    expect(start.status).toBe(HttpStatus.OK)
    const job = await service.client.get(`${CAMPAIGNS}/${id}/start`, AUTH)
    expect(job.data).toEqual({ status: 'DONE', error: null })

    const send = await service.client.post(
      `${CAMPAIGNS}/${id}/send-full`,
      {},
      AUTH,
    )
    expect(send.status).toBe(HttpStatus.OK)
    expect(send.data.status).toBe('INITIAL_SEND_RUNNING')
  })

  it('refuses send-full before the campaign is ready', async () => {
    const id = await copyCampaign()

    const res = await service.client.post(
      `${CAMPAIGNS}/${id}/send-full`,
      {},
      AUTH,
    )

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(res.data.code).toBe('CONFLICT')
  })

  it('returns the vendor error shape for an unknown campaign', async () => {
    const res = await service.client.get(`${CAMPAIGNS}/missing`, AUTH)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(res.data).toMatchObject({
      message: 'No campaign with that ID found in that subaccount',
      code: 'NOT_FOUND',
    })
  })

  it('rejects a copy with a malformed sending number', async () => {
    const res = await service.client.post(
      `${CAMPAIGNS}/${TEMPLATE_ID}/copy`,
      {
        name: 'Panel wave #1',
        contactFields: [],
        scriptVariants: [{ script: 'Hi' }],
        sendingPhoneNumber: '6122388359',
      },
      AUTH,
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(res.data.code).toBe('VALIDATION_ERROR')
  })

  it('rejects a load with an upload token it never issued', async () => {
    const id = await copyCampaign()

    const res = await service.client.post(
      `${CAMPAIGNS}/${id}/contacts/csv-upload`,
      {
        uploadToken: 'never-issued',
        estimatedRowCount: 10,
        phoneNumberColumn: 'cellPhone',
        contactFieldMapping: {},
      },
      AUTH,
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(res.data.code).toBe('INVALID_UPLOAD_TOKEN')
  })

  it('404s a PUT to an upload token it never issued', async () => {
    const res = await service.client.put(
      `${BASE}/mock-uploads/never-issued`,
      CSV,
      {
        headers: { 'Content-Type': 'text/csv' },
      },
    )
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('returns 401 without the mock credentials', async () => {
    const res = await service.client.get(`${CAMPAIGNS}/any`)
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
  })

  it('returns 404 when VENDOR_MODE is live', async () => {
    appEnvOverrides.VENDOR_MODE = 'live'
    const res = await service.client.get(`${CAMPAIGNS}/any`, AUTH)
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})
