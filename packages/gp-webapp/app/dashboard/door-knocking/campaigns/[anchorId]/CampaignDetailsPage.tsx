'use client'

import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeftIcon, Button, Card } from '@styleguide'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import { campaignTurfsQueryOptions } from 'app/dashboard/door-knocking/native/turfQueries'

// The campaign a candidate lands on after creating one, and the surface a
// turf is walked from. It reads the same
// `GET /v1/door-knocking/campaigns/:anchorId` the outreach drawer's sibling
// list reads, so the two cannot disagree about what a campaign holds.
//
// A turf with no route reads as a state rather than a gap: its doors and
// people are frozen when it is drawn, so the counts are real from the
// moment the campaign exists, and `routeSeconds === null` is the only thing
// that says nobody has walked it yet.
type Props = {
  anchorId: number
}

const knockLabel = (routed: boolean, logged: number) =>
  !routed ? 'Start knocking' : logged > 0 ? 'Continue knocking' : 'Walk turf'

export const CampaignDetailsPage = ({ anchorId }: Props) => {
  const router = useRouter()
  const turfs = useQuery(campaignTurfsQueryOptions(anchorId))

  const rows = turfs.data ?? []
  const campaignName = rows[0]?.name ?? 'Campaign'
  const doorTotal = rows.reduce((sum, t) => sum + t.doorCount, 0)
  const peopleTotal = rows.reduce((sum, t) => sum + t.peopleCount, 0)
  const loggedTotal = rows.reduce((sum, t) => sum + t.loggedCount, 0)

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-3xl p-6">
        <Button
          variant="ghost"
          size="small"
          className="mb-4 -ml-2"
          onClick={() => router.push('/dashboard/outreach')}
        >
          <ArrowLeftIcon className="mr-1 size-4" />
          Voter Outreach
        </Button>

        <h1 className="text-2xl font-semibold">{campaignName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? 'turf' : 'turfs'} · {doorTotal}{' '}
          doors · {peopleTotal} people · {loggedTotal} logged
        </p>

        {turfs.isPending && (
          <Card className="mt-6 w-full p-6 text-center text-sm text-muted-foreground">
            Loading this campaign…
          </Card>
        )}

        {turfs.isError && (
          <Card className="mt-6 w-full p-6 text-center text-sm text-muted-foreground">
            This campaign could not load. Refresh to try again.
          </Card>
        )}

        {!turfs.isPending && !turfs.isError && rows.length === 0 && (
          <Card className="mt-6 w-full p-6 text-center text-sm text-muted-foreground">
            No turfs in this campaign yet. Draw one to start knocking.
          </Card>
        )}

        <div className="mt-6 flex flex-col gap-3">
          {rows.map((turf) => {
            const routed = turf.routeSeconds !== null
            return (
              <Card key={turf.id} className="flex items-center gap-4 p-4">
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: turf.color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{turf.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {turf.doorCount} doors · {turf.peopleCount} people
                    {turf.loggedCount > 0 && ` · ${turf.loggedCount} logged`}
                    {/* The honest way to say "nobody has walked this". The
                        counts above are real either way, so the absent
                        figure is the duration, not the audience. */}
                    {!routed && ' · not started'}
                  </p>
                </div>
                <Button
                  size="small"
                  variant={routed ? 'default' : 'outline'}
                  onClick={() =>
                    router.push(
                      `/dashboard/door-knocking?walkTurfId=${turf.id}`,
                    )
                  }
                >
                  {knockLabel(routed, turf.loggedCount)}
                </Button>
              </Card>
            )
          })}
        </div>
      </div>
    </DashboardLayout>
  )
}
