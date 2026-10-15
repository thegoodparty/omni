import pageMetaData from 'helpers/metadataHelper'
import PollsPage from './components/PollsPage'
import serveAccess from '../shared/serveAccess'
import { getPolls } from './shared/serverApiCalls'
import { serverRequest } from 'gpApi/server-request'
import type { Outreach } from 'app/dashboard/outreach/hooks/OutreachContext'

// Self-serve polls are outreach rows, not legacy polls, so the list reads both.
// `ignoreResponseError` keeps a failed read from taking the legacy list down.
const fetchOutreachPolls = async (): Promise<Outreach[]> => {
  const { ok, data } = await serverRequest(
    'GET /v1/outreach/serve',
    {},
    { ignoreResponseError: true },
  )
  return ok ? data.filter((row) => row.outreachType === 'poll') : []
}

export const metadata = pageMetaData({
  title: 'Polls | GoodParty.org',
  description: 'Polls',
  slug: '/dashboard/polls',
})

export const dynamic = 'force-dynamic'

export default async function Page() {
  await serveAccess()
  const [getPollsResponse, outreachPolls] = await Promise.all([
    getPolls(),
    fetchOutreachPolls(),
  ])

  const polls = getPollsResponse.results

  return (
    <PollsPage
      pathname="/dashboard/polls"
      polls={polls}
      outreachPolls={outreachPolls}
    />
  )
}
