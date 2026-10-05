'use client'

import { Button, DownloadIcon } from '@styleguide'

interface CampaignTrackerHeroProps {
  candidateName: string
  race: string
  district: string
  primaryDate: string
  electionDate: string
  onDownload: () => void
  downloading: boolean
  canDownload: boolean
}

// Lovable-style campaign-tracker hero: candidate + race headline, district /
// election-day line, intro copy, and the download action between the intro and
// the first card. The page has no title bar, so the headline is its heading.
const CampaignTrackerHero = ({
  candidateName,
  race,
  district,
  primaryDate,
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
    primaryDate ? `Primary ${primaryDate}` : '',
    electionDate ? `Election Day ${electionDate}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className="mb-8">
      <h1 className="text-foreground text-3xl font-bold sm:text-4xl">
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
      <Button
        type="button"
        variant="outline"
        size="small"
        className="mt-6"
        onClick={onDownload}
        loading={downloading}
        loadingText="Downloading…"
        disabled={!canDownload}
        icon={<DownloadIcon className="size-4" aria-hidden />}
      >
        Download plan
      </Button>
    </section>
  )
}

export default CampaignTrackerHero
