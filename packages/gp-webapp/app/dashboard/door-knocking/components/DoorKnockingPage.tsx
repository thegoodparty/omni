'use client'
import dynamic from 'next/dynamic'
import DashboardLayout from '../../shared/DashboardLayout'
import InteractionsSummary from './InteractionsSummary'
import { apiRoutes } from 'gpApi/routes'
import H1 from '@shared/typography/H1'
import H2 from '@shared/typography/H2'
import Paper from '@shared/utils/Paper'
import { dateWithTime } from 'helpers/dateHelper'
import { Button } from '@styleguide'
import { clientFetch } from 'gpApi/clientFetch'
import { useState } from 'react'
import Body2 from '@shared/typography/Body2'
import { syncEcanvasser } from '@shared/utils/syncEcanvasser'
import DoorKnockingTabs from '../shared/DoorKnockingTabs'
import { Campaign } from 'helpers/types'
import type { EcanvasserSummary } from './types'

// chart.js + react-chartjs-2 is the heaviest dependency this route pulls in, and
// every chart here sits below the fold. All three chart panels
// (InteractionsSummaryPie, InteractionsByDay, RatingSummary) statically import
// chart.js, so all three must load lazily to keep the charting lib out of the
// route's first-load bundle — deferring only one still ships chart.js. Each
// placeholder mirrors its panel's Paper + heading + fixed-height slot so the
// layout stays stable while the chart hydrates.
const ChartPanelFallback = ({
  title,
  className,
}: {
  title: string
  className: string
}): React.JSX.Element => (
  <Paper className={className}>
    <H2 className="mb-8">{title}</H2>
    <div className="h-[400px] flex items-center justify-center">
      <div className="text-gray-500">Loading…</div>
    </div>
  </Paper>
)

const InteractionsSummaryPie = dynamic(
  () => import('./InteractionsSummaryPie'),
  {
    ssr: false,
    loading: () => (
      <ChartPanelFallback
        title="Interactions Status Breakdown"
        className="md:p-6"
      />
    ),
  },
)

const InteractionsByDay = dynamic(() => import('./InteractionsByDay'), {
  ssr: false,
  loading: () => (
    <ChartPanelFallback
      title="Interactions Over Time"
      className="md:p-6 mt-4"
    />
  ),
})

const RatingSummary = dynamic(() => import('./RatingSummary'), {
  ssr: false,
  loading: () => (
    <ChartPanelFallback title="Rating Distribution" className="md:p-6 mt-4" />
  ),
})

interface DoorKnockingPageProps {
  pathname: string
  campaign: Campaign | null
  summary?: EcanvasserSummary
}

async function fetchEcanvasserSummary(): Promise<
  EcanvasserSummary | undefined
> {
  const response = await clientFetch<EcanvasserSummary>(
    apiRoutes.ecanvasser.mySummary,
  )
  return response.data
}

export default function DoorKnockingPage(
  props: DoorKnockingPageProps,
): React.JSX.Element {
  const [summary, setSummary] = useState<EcanvasserSummary | undefined>(
    props.summary,
  )
  const [isSynching, setIsSynching] = useState(false)

  const fetchSummary = async () => {
    const data = await fetchEcanvasserSummary()
    setSummary(data)
  }

  const childProps = {
    ...props,
    summary,
  }

  const handleSync = async (): Promise<void> => {
    setIsSynching(true)
    if (props.campaign) {
      await syncEcanvasser(props.campaign.id, true)
    }
    fetchSummary()
    setIsSynching(false)
  }

  return (
    <DashboardLayout {...props} showAlert={false}>
      <div className="flex justify-between items-center pr-2">
        <div>
          <H1>Interactions</H1>
          <Body2 className="text-gray-500 mb-4">
            Last updated: {dateWithTime(summary?.lastSync || '')}
          </Body2>
        </div>

        <Button
          size="small"
          onClick={handleSync}
          loading={isSynching}
          disabled={isSynching}
        >
          Sync Now
        </Button>
      </div>
      <DoorKnockingTabs activeTab={0} />
      <div className="grid grid-cols-12 gap-4 lg:pr-2 mt-4">
        <div className="col-span-12 xl:col-span-7">
          <InteractionsSummary {...childProps} />
          <InteractionsByDay {...childProps} />
          <RatingSummary {...childProps} />
        </div>
        <div className="col-span-12 xl:col-span-5">
          <InteractionsSummaryPie {...childProps} />
        </div>
      </div>
    </DashboardLayout>
  )
}
