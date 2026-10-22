import type { AxiosInstance } from 'axios'
import { addDays, format } from 'date-fns'
import { withGatewayRetry } from 'tests/utils/headless-user'

// gp-api closes texting 19 days before a campaign's general election and
// counts the week before that down (smsComplianceWindow). The test campaign
// keeps its real race's election date, so a spec that needs texting open
// moves that date a fixed distance from today instead of trusting the
// calendar. Use it only on an isolated user: the shared one is read by other
// specs on the same worker.
const OPEN_WINDOW_DAYS_TO_ELECTION = 60

export const openSmsWindow = async (client: AxiosInstance): Promise<void> => {
  await withGatewayRetry('PUT /v1/campaigns/mine', () =>
    client.put('/v1/campaigns/mine', {
      details: {
        electionDate: format(
          addDays(new Date(), OPEN_WINDOW_DAYS_TO_ELECTION),
          'yyyy-MM-dd',
        ),
      },
    }),
  )
}
