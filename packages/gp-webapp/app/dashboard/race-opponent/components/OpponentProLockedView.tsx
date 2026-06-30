'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ProBadge,
} from '@styleguide'
import {
  LockIcon,
  MessageSquareIcon,
  ScaleIcon,
  SearchIcon,
  ShieldIcon,
} from '@styleguide/components/ui/icons'
import { CAMPAIGN_QUERY_KEY } from '@shared/hooks/CampaignProvider'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

// $10/mo + 7-day trial are hardcoded here to match the ValuePropStep /
// ProUpgradeModal copy. The live Stripe price is only available inside the
// pro-upgrade checkout (OrderSummary reads it from the mounted checkout); there
// is no shared pricing constant to source from on this static pitch surface.
const BENEFITS: ReadonlyArray<{
  icon: React.ComponentType<{ className?: string }>
  label: string
  description: string
}> = [
  {
    icon: SearchIcon,
    label: 'Deep opponent research',
    description:
      'Voting records, finance filings, public statements — pulled and summarized for every opponent in your race.',
  },
  {
    icon: ScaleIcon,
    label: 'Issue-by-issue contrast',
    description:
      'Side-by-side positions on the issues your district actually cares about, with cited evidence.',
  },
  {
    icon: ShieldIcon,
    label: 'Threat & vulnerability scoring',
    description:
      'Know who to spend against, who to ignore, and where your opponents are weakest.',
  },
  {
    icon: MessageSquareIcon,
    label: 'Ready-to-send messaging',
    description:
      'Drafted contrast scripts and outreach copy generated from the research — not boilerplate.',
  },
]

const OpponentProLockedView = (): React.JSX.Element => {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)

  // The locked upgrade pitch is the only screen a non-Pro candidate sees here,
  // so its render IS the "viewed the upgrade gate" funnel step. Fire once on
  // mount (empty deps), not per render.
  useEffect(() => {
    trackEvent(EVENTS.RaceOpponent.UpgradeViewed)
  }, [])

  // A candidate who upgraded in another tab won't have isPro flipped in this
  // tab's cached campaign. Refetch the shared campaign query, then re-run the
  // server component (which gates the real feature on isPro) so the feature
  // reveals without a full reload.
  const handleRefresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await queryClient.invalidateQueries({ queryKey: CAMPAIGN_QUERY_KEY })
      router.refresh()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col px-6 py-10">
      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="soft" className="gap-1">
              <ProBadge size="small" />
              Pro feature
            </Badge>
            <Badge variant="outline" className="gap-1">
              <LockIcon />
              Locked
            </Badge>
          </div>
          <div className="flex flex-col gap-2">
            <CardTitle className="text-2xl font-semibold text-foreground">
              Unlock opponent research with Pro
            </CardTitle>
            <CardDescription className="text-base text-muted-foreground">
              See voting records, finance, vulnerabilities, and ready-to-send
              contrast messaging for every candidate in your race.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold text-foreground">$10</span>
            <span className="text-base text-muted-foreground">/ month</span>
            <span className="text-sm text-muted-foreground">
              7-day free trial
            </span>
          </div>

          <Button
            size="large"
            onClick={() => router.push('/dashboard/pro-upgrade')}
          >
            Upgrade to Pro
          </Button>

          <p className="text-sm text-muted-foreground">
            Cancel anytime. Already on Pro?{' '}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="font-medium text-foreground underline disabled:opacity-60"
            >
              Refresh
            </button>
          </p>

          <div className="flex flex-col gap-3 border-t border-base-border pt-6">
            <p className="text-sm font-semibold text-foreground">
              What you get
            </p>
            <ul className="flex list-none flex-col gap-4">
              {BENEFITS.map(({ icon: Icon, label, description }) => (
                <li
                  key={label}
                  className="flex items-start gap-3 text-foreground"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-grayscale-200">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-base font-medium">{label}</span>
                    <span className="text-sm text-muted-foreground">
                      {description}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default OpponentProLockedView
