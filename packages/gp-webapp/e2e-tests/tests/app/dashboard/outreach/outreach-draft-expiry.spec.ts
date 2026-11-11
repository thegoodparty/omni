import { readFileSync } from 'fs'
import { join } from 'path'
import { expect, test } from '@playwright/test'
import {
  mockRecords,
  runJob,
  timeTravel,
} from 'src/helpers/vendor-mocks.helper'
import { eventually } from 'tests/utils/eventually'
import {
  createHeadlessTestUser,
  withGatewayRetry,
} from 'tests/utils/headless-user'

const IMAGE = readFileSync(
  join(__dirname, '../../../../src/fixtures/heart.png'),
)

// The outreachDraftExpiry pg-boss schedule runs daily. A fixture moves the
// candidate's saved draft past its retention and queues one run of the real
// schedule, which deletes it the way the daily run would.
test('a saved text draft past its retention leaves the outreach list', async () => {
  const { client, campaignId } = await createHeadlessTestUser({
    product: 'win',
  })
  if (campaignId === undefined) throw new Error('No campaign created')

  const { vendorMode } = await mockRecords(client, campaignId)
  test.skip(vendorMode !== 'mock', 'The fixtures run only with vendor mocks')

  const { data: list } = await withGatewayRetry(
    'POST /v1/voters/voter-file/filter',
    () =>
      client.post<{ id: number }>('/v1/voters/voter-file/filter', {
        name: 'Draft expiry list',
      }),
  )
  const form = new FormData()
  form.append('outreachType', 'p2p')
  form.append('name', 'Draft expiry text')
  form.append('voterFileFilterId', String(list.id))
  form.append('script', 'Hi, this is a test draft.')
  form.append('file', new Blob([IMAGE], { type: 'image/png' }), 'heart.png')
  const { data: draft } = await withGatewayRetry(
    'POST /v1/outreach/drafts',
    () =>
      client.post<{ id: number; status: string }>('/v1/outreach/drafts', form),
  )
  expect(draft.status).toBe('draft')

  const listedIds = async () => {
    const { data } = await client.get<{ id: number }[]>('/v1/outreach')
    return data.map((outreach) => outreach.id)
  }
  expect(await listedIds()).toContain(draft.id)

  await timeTravel(client, draft.id, 'draft.past_retention')
  await withGatewayRetry('outreachDraftExpiry', () =>
    runJob(client, 'outreachDraftExpiry'),
  )

  await eventually({ that: 'the expired draft is gone' }, async () => {
    expect(await listedIds()).not.toContain(draft.id)
  })
})
