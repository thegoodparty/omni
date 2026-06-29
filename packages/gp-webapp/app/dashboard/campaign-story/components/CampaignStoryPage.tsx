'use client'

import { useState } from 'react'
import Link from 'next/link'
import DashboardLayout from '../../shared/DashboardLayout'
import FeatureFlagGuard from '@shared/experiments/FeatureFlagGuard'
import Paper from '@shared/utils/Paper'
import H2 from '@shared/typography/H2'
import { BookOpenIcon, Button, Card } from '@styleguide'
import type { CampaignStory } from '@goodparty_org/contracts'
import type { WebsiteIssue } from 'helpers/types'
import { useSnackbar } from 'helpers/useSnackbar'
import { saveAboutFields } from 'app/dashboard/website/util/website.util'
import PolicyPriorities from 'app/dashboard/profile/texting-compliance/candidate-profile/components/PolicyPriorities'
import { CAMPAIGN_STORY_FLAG_KEY } from '@shared/experiments/campaignStoryFlag'
import { CAMPAIGN_STORY_SECTIONS } from '../sections'
import { isStoryFieldAnswered } from '../useCampaignStory'
import type { CampaignStoryField } from './CampaignStoryCard'
import CampaignStoryCard from './CampaignStoryCard'

interface CampaignStoryPageProps {
  pathname?: string
  initialStory: CampaignStory
  // The candidate's issues, sourced from their website (shared with the
  // Pro-upgrade flow). Empty when they have no website/issues yet.
  initialIssues: WebsiteIssue[]
}

const answeredFromStory = (
  story: CampaignStory,
): Record<CampaignStoryField, boolean> => ({
  why: isStoryFieldAnswered(story.why),
  background: isStoryFieldAnswered(story.background),
})

const CampaignStoryPage = ({
  pathname,
  initialStory,
  initialIssues,
}: CampaignStoryPageProps): React.JSX.Element => {
  const { errorSnackbar } = useSnackbar()
  // Seeded from the persisted story, then updated live as each card reports its
  // answered-state on every keystroke — so the footer appears as soon as both
  // have content, without waiting for blur/save.
  const [answered, setAnswered] = useState(() =>
    answeredFromStory(initialStory),
  )
  // Issues are the website issues; edited here via the shared PolicyPriorities
  // editor and persisted to website.content.about.issues on every change
  // (saveAboutFields creates the site on first write).
  const [issues, setIssues] = useState<WebsiteIssue[]>(initialIssues)

  // Persist on every change. saveAboutFields serializes overlapping writes and
  // creates the website on first save, so no debounce/guard is needed here.
  const handleIssuesChange = (next: WebsiteIssue[]): void => {
    setIssues(next)
    void saveAboutFields({ issues: next }).then((ok) => {
      if (!ok) errorSnackbar('Could not save your issues. Please try again.')
    })
  }

  const allAnswered = answered.why && answered.background && issues.length > 0

  return (
    <FeatureFlagGuard flagKey={CAMPAIGN_STORY_FLAG_KEY}>
      <DashboardLayout
        pathname={pathname}
        wrapperClassName="w-full"
        showAlert={false}
      >
        <Paper className="mx-auto flex w-full max-w-3xl flex-col gap-8">
          <header className="flex items-center gap-2">
            <BookOpenIcon className="size-6" />
            <H2>Campaign Story</H2>
          </header>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">
              Campaign Story
            </h3>
            <p className="text-base text-muted-foreground">
              This is necessary to personalize your Campaign Plan, Campaign
              Tracker, and your GoodParty.org experience.
            </p>
          </section>

          <div className="flex flex-col gap-6">
            {CAMPAIGN_STORY_SECTIONS.map((section) => (
              <CampaignStoryCard
                key={section.id}
                section={section}
                initialValue={initialStory[section.id]}
                onAnsweredChange={(value) =>
                  setAnswered((prev) =>
                    prev[section.id] === value
                      ? prev
                      : { ...prev, [section.id]: value },
                  )
                }
              />
            ))}

            <Card className="p-6">
              <div className="flex flex-col gap-1">
                <h3 className="text-xl font-semibold text-foreground">
                  Your issues
                </h3>
                <p className="text-sm text-muted-foreground">
                  Two to four concrete fights for your first term. These are
                  shared with your campaign website.
                </p>
              </div>
              <PolicyPriorities
                issues={issues}
                onChange={handleIssuesChange}
                hideToolbar
              />
            </Card>
          </div>

          {allAnswered && (
            <div className="sticky bottom-4 z-10 flex flex-col items-stretch gap-3 rounded-xl border border-border bg-white p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm font-medium text-foreground">
                Your Campaign Story is ready.
              </span>
              <Button asChild className="sm:shrink-0">
                <Link href="/dashboard/campaign-plan">
                  Generate my Campaign Plan
                </Link>
              </Button>
            </div>
          )}
        </Paper>
      </DashboardLayout>
    </FeatureFlagGuard>
  )
}

export default CampaignStoryPage
