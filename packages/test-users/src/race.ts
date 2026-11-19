import type { AxiosInstance } from 'axios'
import type {
  ApplyTestFixtureElectionResponse,
  RaceListItem,
  TestModeElectionPreset,
} from '@goodparty_org/contracts'
import realWorldReferences from './real-world-references.json'
import { withGatewayRetry } from './api'

export type TestRace = { zip: string; office: string }

// The office every test campaign is created on unless it names another: a
// real BallotReady office with real voter rows in the dev people-db. Only the
// office is real. The election date always comes from a preset. It lives in
// real-world-references.json so the daily horizon check watches the same one.
export const DEFAULT_TEST_RACE: TestRace = realWorldReferences.defaultOffice

// gp-api resolves the office whatever today's date is: its next race, else
// its most recent past one. So an office's election passing never breaks
// setup; the race supplies the position and district, never the date.
export const resolveTestRace = async (
  client: AxiosInstance,
  race: TestRace = DEFAULT_TEST_RACE,
): Promise<RaceListItem> => {
  const { data } = await withGatewayRetry(
    'GET /v1/test-fixtures/races/resolve',
    () =>
      client.get<RaceListItem>('/v1/test-fixtures/races/resolve', {
        params: race,
      }),
  )
  return data
}

// `in_8_weeks` keeps a campaign well outside the 19-day texting cutoff.
export const DEFAULT_ELECTION_PRESET: TestModeElectionPreset = 'in_8_weeks'

// Declares the campaign's election state. gp-api computes the date from its
// own clock (the same presets staff Test mode uses), so nothing does date math
// and nothing inherits a real race's date.
export const applyElectionPreset = async (
  client: AxiosInstance,
  campaignId: number,
  preset: TestModeElectionPreset,
): Promise<ApplyTestFixtureElectionResponse> => {
  const { data } = await withGatewayRetry(
    'POST /v1/test-fixtures/campaigns/:id/election',
    () =>
      client.post<ApplyTestFixtureElectionResponse>(
        `/v1/test-fixtures/campaigns/${campaignId}/election`,
        { preset },
      ),
  )
  return data
}
