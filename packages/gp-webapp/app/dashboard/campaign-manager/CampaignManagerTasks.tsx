'use client'

import ManagerPromptCard from './ManagerPromptCard'
import GetOnBallotCard from './GetOnBallotCard'
import PersonalizeStoryCard from './PersonalizeStoryCard'
import StoryReadyCard from './StoryReadyCard'

interface Props {
  // Whether the first-run "meet your campaign manager" card is shown. Owned by
  // CampaignManagerHome, which dismisses it on a general manager open (the meet
  // card or the footer chat box), not on the story flow.
  showMeetCard: boolean
  onMeetManager: () => void
  // Dismisses the meet card without opening the manager (the card's ⋮ Skip).
  onSkipMeet: () => void
  onPersonalize: () => void
  onGetOnBallot: () => void
}

export default function CampaignManagerTasks({
  showMeetCard,
  onMeetManager,
  onSkipMeet,
  onPersonalize,
  onGetOnBallot,
}: Props): React.JSX.Element {
  return (
    <section className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 py-6">
      {showMeetCard && (
        <ManagerPromptCard
          title="Meet your virtual Campaign Manager"
          description="Introducing your Campaign Manager. Get a quick tour for how it can help."
          ctaLabel="Meet your Campaign Manager"
          onCta={onMeetManager}
          onSkip={onSkipMeet}
        />
      )}

      {/* Only for the candidate who said they have not filed yet; getting on
          the ballot outranks personalizing, so it sits above the story cards. */}
      <GetOnBallotCard onGetOnBallot={onGetOnBallot} />

      {/* Mutually exclusive: PersonalizeStoryCard shows while the story is
          incomplete, StoryReadyCard once it's complete. */}
      <PersonalizeStoryCard onPersonalize={onPersonalize} />
      <StoryReadyCard />
    </section>
  )
}
