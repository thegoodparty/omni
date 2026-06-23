'use client'

import { useState } from 'react'
import Link from 'next/link'
import DashboardLayout from '../../shared/DashboardLayout'
import FeatureFlagGuard from '@shared/experiments/FeatureFlagGuard'
import Paper from '@shared/utils/Paper'
import H2 from '@shared/typography/H2'
import { BookOpenIcon, Button } from '@styleguide'
import type { CampaignStory } from '@goodparty_org/contracts'
import { CAMPAIGN_STORY_FLAG_KEY } from '@shared/experiments/campaignStoryFlag'
import { CAMPAIGN_STORY_SECTIONS } from '../sections'
import { isStoryFieldAnswered } from '../useCampaignStory'
import type { CampaignStoryField } from './CampaignStoryCard'
import CampaignStoryCard from './CampaignStoryCard'

interface CampaignStoryPageProps {
  pathname?: string
  initialStory: CampaignStory
}

const answeredFromStory = (
  story: CampaignStory,
): Record<CampaignStoryField, boolean> => ({
  why: isStoryFieldAnswered(story.why),
  background: isStoryFieldAnswered(story.background),
  issues: isStoryFieldAnswered(story.issues),
})

const CampaignStoryPage = ({
  pathname,
  initialStory,
}: CampaignStoryPageProps): React.JSX.Element => {
  // Seeded from the persisted story, then updated live as each card reports its
  // answered-state on every keystroke — so the footer appears as soon as all
  // three have content, without waiting for blur/save.
  const [answered, setAnswered] = useState(() =>
    answeredFromStory(initialStory),
  )
  const allAnswered = answered.why && answered.background && answered.issues

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
