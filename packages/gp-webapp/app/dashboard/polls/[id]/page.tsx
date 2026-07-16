import pageMetaData from 'helpers/metadataHelper'
import PollsDetailPage from './components/PollsDetailPage'
import serveAccess from '../../shared/serveAccess'
import { PollProvider } from '../shared/hooks/PollProvider'
import { IssuesProvider } from '../shared/hooks/IssuesProvider'
import { getPoll, getPollTopIssues } from '../shared/serverApiCalls'
import { redirect } from 'next/navigation'

const meta = pageMetaData({
  title: 'Polls | GoodParty.org',
  description: 'Polls',
  slug: '/dashboard/polls',
})
export const metadata = meta

export const dynamic = 'force-dynamic'

interface Params {
  id: string
}

export default async function Page({
  params,
}: {
  params: Promise<Params>
}): Promise<React.JSX.Element> {
  await serveAccess()
  const { id } = await params
  // Both reads depend only on `id`, so fetch them concurrently. A missing poll
  // still redirects before the (now already in-flight) top-issues result is
  // touched, and any failure from either call is re-surfaced exactly as the
  // serial version would have thrown it — the only cost is a rare wasted
  // top-issues fetch when the poll doesn't exist.
  const [pollResult, issuesResult] = await Promise.allSettled([
    getPoll(id),
    getPollTopIssues(id),
  ])
  if (pollResult.status === 'rejected') {
    throw pollResult.reason
  }
  const poll = pollResult.value
  if (!poll) {
    redirect('/dashboard/polls')
  }
  if (issuesResult.status === 'rejected') {
    throw issuesResult.reason
  }
  // `getPollTopIssues` resolves (doesn't throw) on a 2xx with an empty/missing
  // body (e.g. 204), so guard the payload like the sibling issue page does.
  const issues = issuesResult.value?.results ?? []

  return (
    <PollProvider poll={poll}>
      <IssuesProvider issues={issues}>
        <PollsDetailPage pathname="/dashboard/polls" />
      </IssuesProvider>
    </PollProvider>
  )
}
