'use client'

import { Button, DownloadIcon } from '@styleguide'

interface CampaignTrackerHeroProps {
  candidateName: string
  race: string
  district: string
  electionDate: string
  onDownload: () => void
  downloading: boolean
  canDownload: boolean
}

// Lovable-style campaign-tracker hero: eyebrow, candidate + race headline,
// district / election-day line, intro copy, and a download action. Replaces
// the old centered "Campaign Plan" HeroCard on the dashboard plan page.
const CampaignTrackerHero = ({
  candidateName,
  race,
  district,
  electionDate,
  onDownload,
  downloading,
  canDownload,
}: CampaignTrackerHeroProps): React.JSX.Element => {
  const headline =
    candidateName && race
      ? `${candidateName} for ${race}`
      : candidateName || race || 'Your campaign'
  const metaLine = [
    district ? `District ${district}` : '',
    electionDate ? `Election Day ${electionDate}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className="mb-8">
      <div className="flex items-start justify-between gap-4">
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Campaign tracker
        </p>
        <Button
          type="button"
          variant="outline"
          size="medium"
          icon={<DownloadIcon className="size-4" />}
          onClick={onDownload}
          loading={downloading}
          disabled={!canDownload}
          className="shrink-0"
        >
          Download Campaign Plan
        </Button>
      </div>
      <h1 className="text-foreground mt-2 text-3xl font-bold sm:text-4xl">
        {headline}
      </h1>
      {metaLine && (
        <p className="text-muted-foreground mt-1 text-base">{metaLine}</p>
      )}
      <p className="text-foreground mt-4 max-w-2xl">
        Running for office is hard, especially the first time. This plan tells
        you what to do, when to do it, and how to reach the voters who decide
        your race. It is built from public voter records and past elections in
        your area, and it shapes itself around you as you go.
      </p>
    </section>
  )
}

export default CampaignTrackerHero
