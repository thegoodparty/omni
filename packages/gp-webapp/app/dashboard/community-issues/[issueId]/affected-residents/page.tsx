import Link from 'next/link'
import { notFound } from 'next/navigation'
import pageMetaData from 'helpers/metadataHelper'
import { serverRequest } from 'gpApi/server-request'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import FeatureFlagGuard from '@shared/experiments/FeatureFlagGuard'
import { AFFECTED_RESIDENTS_FLAG_KEY } from '@shared/experiments/affectedResidentsFlag'
import serveAccess from '../../../shared/serveAccess'
import DashboardLayout from '../../../shared/DashboardLayout'
import IssuesNavHeader from '../../components/IssuesNavHeader'
import CommunityIssuesChatDock from '../../components/CommunityIssuesChatDock'
import AffectedResidentsView from './components/AffectedResidentsView'

export const metadata = pageMetaData({
  title: 'Affected residents | GoodParty.org',
  description: 'Residents most affected by a community issue',
  slug: '/dashboard/community-issues',
})
export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ issueId: string }>
}

export default async function Page({
  params,
}: Props): Promise<React.JSX.Element> {
  await serveAccess()

  const { issueId } = await params

  let result
  try {
    result = await serverRequest(
      'GET /v1/community-issues/:id/affected-residents',
      { id: issueId },
    )
  } catch {
    notFound()
  }

  return (
    <DashboardLayout
      pathname="/dashboard/community-issues"
      showAlert={false}
      wrapperClassName="!p-0"
    >
      <div className="flex min-h-screen flex-col">
        <IssuesNavHeader />
        <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 px-6 pb-28 pt-6">
          <Link
            href={`/dashboard/community-issues/${issueId}`}
            className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" aria-hidden />
            Back to this issue
          </Link>
          {/* Client-side, so the props below are in the RSC payload before the
              guard decides to render nothing. That is not a leak — gp-api
              scopes the list to the caller's own office — but it does mean the
              flag is not a transport-level gate. */}
          <FeatureFlagGuard
            flagKey={AFFECTED_RESIDENTS_FLAG_KEY}
            redirectTo={`/dashboard/community-issues/${issueId}`}
          >
            {result.data.list ? (
              <AffectedResidentsView list={result.data.list} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No affected-residents list has been built for this issue yet.
              </p>
            )}
          </FeatureFlagGuard>
        </div>
        <CommunityIssuesChatDock />
      </div>
    </DashboardLayout>
  )
}
