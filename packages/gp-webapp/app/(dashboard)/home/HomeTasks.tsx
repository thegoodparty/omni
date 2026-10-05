'use client'

import ManagerPromptCard from './ManagerPromptCard'
import NextThingCard from './NextThingCard'
import PersonalizeStoryCard from './PersonalizeStoryCard'
import StoryReadyCard from './StoryReadyCard'

interface Props {
  // Whether the first-run "take a quick tour" card is shown. Owned by Home,
  // which dismisses it on a general chat open (the tour card or the footer
  // chat box), not on the story flow.
  showMeetCard: boolean
  onMeetManager: () => void
  // Dismisses the tour card without opening chat (the card's ⋮ Skip).
  onSkipMeet: () => void
  onPersonalize: () => void
}

export default function HomeTasks({
  showMeetCard,
  onMeetManager,
  onSkipMeet,
  onPersonalize,
}: Props): React.JSX.Element {
  return (
    <section className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 py-6">
      {showMeetCard && (
        <ManagerPromptCard
          title="Take a quick tour"
          description="See what chat can help you with, from outreach drafts to your next steps."
          ctaLabel="Start the tour"
          onCta={onMeetManager}
          onSkip={onSkipMeet}
        />
      )}

      <NextThingCard />

      {/* Mutually exclusive: PersonalizeStoryCard shows while the story is
          incomplete, StoryReadyCard once it's complete. */}
      <PersonalizeStoryCard onPersonalize={onPersonalize} />
      <StoryReadyCard />
    </section>
  )
}
