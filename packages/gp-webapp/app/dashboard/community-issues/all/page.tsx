import Link from 'next/link'
import pageMetaData from 'helpers/metadataHelper'
import { serverRequest } from 'gpApi/server-request'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import serveAccess from '../../shared/serveAccess'
import DashboardLayout from '../../shared/DashboardLayout'
import IssueCard from '../components/IssueCard'
import IssuesNavHeader from '../components/IssuesNavHeader'
import CommunityIssuesChatDock from '../components/CommunityIssuesChatDock'

export const metadata = pageMetaData({
  title: 'Top community issues | GoodParty.org',
  description: 'All top community issues',
  slug: '/dashboard/community-issues/all',
})
export const dynamic = 'force-dynamic'

export default async function Page(): Promise<React.JSX.Element> {
  await serveAccess()

  const { data } = await serverRequest('GET /v1/community-issues', {
    list: 'top_community',
  })

  const issues = [...data.issues]
    .filter((i) => i.rank !== null)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))

  return (
    <DashboardLayout
      pathname="/dashboard/community-issues"
      showAlert={false}
      wrapperClassName="!p-0"
    >
      <div className="flex min-h-screen flex-col">
        <IssuesNavHeader />
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-6 pb-28 pt-6">
          <Link
            href="/dashboard/community-issues"
            className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" aria-hidden />
            Back to issues
          </Link>
          <h1 className="text-base font-semibold text-foreground">
            Top community issues
          </h1>
          {issues.length === 0 ? (
            <p className="text-sm text-muted-foreground">No issues found.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="divide-y divide-border">
                {issues.map((issue) => (
                  <IssueCard key={issue.id} issue={issue} showCategory />
                ))}
              </div>
            </div>
          )}
        </div>
        <CommunityIssuesChatDock />
      </div>
    </DashboardLayout>
  )
}
