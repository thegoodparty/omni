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
import CampaignStoryCard, {
  type CampaignStoryField,
  type CampaignStorySection,
} from './CampaignStoryCard'

interface CampaignStoryPageProps {
  pathname?: string
  initialStory: CampaignStory
}

const SECTIONS: CampaignStorySection[] = [
  {
    id: 'why',
    title: 'Your why',
    description:
      'The moment, the people, the breaking point: your stump-speech opener.',
    placeholder:
      'Tap to write: what pushed you to put your name on the ballot?',
  },
  {
    id: 'background',
    title: 'Your background',
    description:
      'Childhood, career, community ties. The human story behind the candidate.',
    placeholder: 'Tap to write: your background, career, and what shaped you.',
  },
  {
    id: 'issues',
    title: 'Your issues',
    description: 'Two to four concrete fights for your first term.',
    placeholder:
      "Tap to write: the 2-4 issues you'd spend political capital on.",
  },
]

const answeredFromStory = (
  story: CampaignStory,
): Record<CampaignStoryField, boolean> => ({
  why: (story.why ?? '').trim().length > 0,
  background: (story.background ?? '').trim().length > 0,
  issues: (story.issues ?? '').trim().length > 0,
})

const CampaignStoryPage = ({
  pathname,
  initialStory,
}: CampaignStoryPageProps): React.JSX.Element => {
  // Seeded from the persisted story; each card reports its saved state so the
  // footer reflects what's actually stored (and what the plan tab will read).
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
              This is the foundation we build everything else on: your why, your
              background, and the issues you&apos;ll fight for. The answers you
              give us here personalize your campaign plan, your stump speech,
              and the messages we draft for voters. Tap any answer to edit it
              directly, or let your Campaign Manager help you sharpen it.
            </p>
          </section>

          <div className="flex flex-col gap-6">
            {SECTIONS.map((section) => (
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
