import { expect, test } from 'src/fixtures/test'
import {
  mockAction,
  mockRecords,
  runJob,
} from 'src/helpers/vendor-mocks.helper'
import { eventually } from 'tests/utils/eventually'
import {
  createHeadlessTestUser,
  withGatewayRetry,
} from 'tests/utils/headless-user'

type MyOffice = {
  campaignId: number | null
  onboardingCompletedAt: string | null
}

// A DDHQ result reaches Postgres from the data platform, never through
// gp-api, so only the daily winOfficeSweep pg-boss schedule gives that
// winner their office. A fixture writes the result the same way and queues
// one run of the real schedule. "I won" itself is election-result-flow.spec.ts.
test('a DDHQ win gets its dormant office from the daily sweep', async () => {
  const { client, campaignId } = await createHeadlessTestUser({
    product: 'win',
    election: 'passed_unanswered',
  })
  if (campaignId === undefined) throw new Error('No campaign created')

  const { vendorMode } = await mockRecords(client, campaignId)
  test.skip(vendorMode !== 'mock', 'The fixtures run only with vendor mocks')

  await mockAction(client, campaignId, 'ddhq.result.won')
  const myOffices = async () =>
    (await client.get<MyOffice[]>('/v1/elected-office/mine')).data
  expect(await myOffices()).toEqual([])

  await withGatewayRetry('winOfficeSweep', () =>
    runJob(client, 'winOfficeSweep'),
  )

  const offices = await eventually(
    { that: 'the sweep creates the office for the win' },
    async () => {
      const mine = await myOffices()
      expect(mine).toHaveLength(1)
      return mine
    },
  )
  // Linked to the campaign and unfinished: the winner's Serve onboarding
  // pledge is what finishes it.
  expect(offices[0]).toMatchObject({ campaignId, onboardingCompletedAt: null })
  const { data } = await client.get<{ organizations: { slug: string }[] }>(
    '/v1/organizations',
  )
  expect(data.organizations.some((org) => org.slug.startsWith('eo-'))).toBe(
    true,
  )
})
