'use client'

import { DownloadIcon, IconButton } from '@styleguide'
import DashboardNavHeaderAction from '../../shared/DashboardNavHeaderAction'

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
// election-day line, and intro copy. The "Campaign tracker" eyebrow is gone —
// the page's title bar (DashboardLayout's navHeader) carries the tab name now,
// so the eyebrow only repeated it — and the download action portals up into
// that bar, aligned top right.
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
      {/* size="small" so the CTA clears the title bar's fixed h-14 without
          growing it past the other pages' bars. */}
      <DashboardNavHeaderAction>
        <IconButton
          type="button"
          variant="outline"
          size="small"
          onClick={onDownload}
          loading={downloading}
          disabled={!canDownload}
          aria-label="Download Campaign Plan"
          className="shrink-0"
        >
          <DownloadIcon className="size-4" aria-hidden />
        </IconButton>
      </DashboardNavHeaderAction>
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
    </section>
  )
}

export default CampaignTrackerHero
