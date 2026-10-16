'use client'
import { useState } from 'react'
import DashboardLayout from '../../shared/DashboardLayout'
import Body1 from '@shared/typography/Body1'
import Paper from '@shared/utils/Paper'
import { PollsTable } from './PollsTable'
import PollWelcomePage from 'app/polls/welcome/components/PollWelcomePage'
import { Button, PlusIcon } from '@styleguide'
import Link from 'next/link'
import { Poll } from '../shared/poll-types'
import type { Outreach } from 'app/dashboard/outreach/hooks/OutreachContext'
import { PollFlow } from 'app/dashboard/outreach/v2/poll/PollFlow'
import { useServeSelfServePollsFlag } from '@shared/experiments/serveSelfServePollsFlag'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

interface PollsPageProps {
  pathname: string
  polls: Poll[]
  outreachPolls?: Outreach[]
}

export default function PollsPage({
  pathname,
  polls,
  outreachPolls = [],
}: PollsPageProps) {
  const { ready, enabled } = useServeSelfServePollsFlag()
  const selfServe = ready && enabled
  const [flowOpen, setFlowOpen] = useState(false)
  const [rows, setRows] = useState(outreachPolls)
  const shownRows = selfServe ? rows : []
  const hasPolls = polls.length > 0 || shownRows.length > 0

  // Best-effort: the paid poll only exists once the server has held it, and a
  // failed re-read must not fail a payment that already went through.
  const refetchRows = async () => {
    try {
      const { ok, data } = await clientRequest(
        'GET /v1/outreach/serve',
        {},
        { ignoreResponseError: true },
      )
      if (ok) setRows(data.filter((row) => row.outreachType === 'poll'))
    } catch {
      // The previously loaded rows stay; the next page load reads again.
    }
  }

  return (
    <DashboardLayout
      pathname={pathname}
      showAlert={false}
      navHeader={{ icon: 'send', label: 'Polls' }}
    >
      <Paper className="min-h-full">
        <div className="flex justify-between items-center">
          <div>
            <Body1 className="text-gray-500 mb-4">
              Manage your constituent engagement
            </Body1>
          </div>
          {selfServe && (
            <Button
              onClick={() => {
                trackEvent(EVENTS.createPoll.createPollClicked)
                setFlowOpen(true)
              }}
            >
              <PlusIcon />
              Create Poll
            </Button>
          )}
          {!selfServe && hasPolls && (
            <Button
              asChild
              onClick={() => {
                trackEvent(EVENTS.createPoll.createPollClicked)
              }}
            >
              <Link href="/dashboard/polls/create">
                <PlusIcon />
                Create Poll
              </Link>
            </Button>
          )}
        </div>
        {hasPolls || selfServe ? (
          <PollsTable polls={polls} outreachPolls={shownRows} />
        ) : (
          <PollWelcomePage />
        )}
        {selfServe && (
          <PollFlow
            open={flowOpen}
            onClose={() => setFlowOpen(false)}
            onScheduled={refetchRows}
          />
        )}
      </Paper>
    </DashboardLayout>
  )
}
