'use client'

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import ManagerPromptCard from './ManagerPromptCard'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import {
  isVoterContactFlowType,
  useToggleTrackerTaskComplete,
  useTrackerTasks,
} from '../campaign-plan/components/campaignStrategy/useTrackerTasks'
import TaskCard from '../chief-of-staff/components/TaskCard'
import GetOnBallotCard from './GetOnBallotCard'
import PersonalizeStoryCard from './PersonalizeStoryCard'
import StoryReadyCard from './StoryReadyCard'
import CountModal from '../components/tasks/CountModal'
import { selectTopDynamicTasks } from './selectTopDynamicTasks'
import { taskCtaLabel, taskHref, taskMeta } from './trackerTaskCta'

// Tracker dates arrive as UTC-midnight ISO; slice to the date portion so the
// local render does not land on the previous day in US timezones.
const formatDue = (iso: string): string =>
  format(parseISO(iso.slice(0, 10)), 'EEE, MMM d')

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
  const { tasks, isPending, isError, isGeneratingDynamic } = useTrackerTasks()
  const top = selectTopDynamicTasks(tasks)

  const toggleComplete = useToggleTrackerTaskComplete()
  // A count-flowType task pending its voter-contact count in the modal.
  const [countTask, setCountTask] = useState<CampaignTrackerTask | null>(null)

  const onComplete = (task: CampaignTrackerTask): void => {
    if (isVoterContactFlowType(task.flowType)) {
      setCountTask(task)
      return
    }
    toggleComplete.mutate({ id: task.id, completed: true })
  }

  const onCountSubmit = (count: number): void => {
    if (!countTask?.flowType) return
    toggleComplete.mutate({
      id: countTask.id,
      completed: true,
      type: countTask.flowType,
      quantity: count,
    })
    setCountTask(null)
  }

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

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Your top priorities this week
        </h2>
        {isPending ? (
          <p className="text-sm text-muted-foreground">Loading your tasks.</p>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">
            We could not load your tasks. Refresh to try again.
          </p>
        ) : isGeneratingDynamic ? (
          <p className="text-sm text-muted-foreground">
            We are preparing your personalized tasks. New tasks arrive every
            Monday morning.
          </p>
        ) : top.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tasks to show yet. Your manager will surface priorities as your
            plan develops.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {top.map((task, index) => {
              const { label, Icon } = taskMeta(task.flowType)
              return (
                <TaskCard
                  key={task.id}
                  eyebrowLabel={label}
                  EyebrowIcon={Icon}
                  title={task.title}
                  meta={[formatDue(task.date)]}
                  summary={task.description || undefined}
                  // With its own action link, "Open" it (like the tracker);
                  // text/robocall start the outreach flow; otherwise route to
                  // the tracker to act on it there.
                  ctaLabel={taskCtaLabel(task)}
                  ctaHref={taskHref(task)}
                  onComplete={() => onComplete(task)}
                  completeDisabled={toggleComplete.isPending}
                  // Only the top priority card gets the subtle gradient.
                  gradient={index === 0}
                />
              )
            })}
          </div>
        )}
      </div>

      {countTask && (
        <CountModal
          open
          onOpenChange={(next) => {
            if (!next) setCountTask(null)
          }}
          flowType={countTask.flowType ?? ''}
          onSubmit={onCountSubmit}
        />
      )}
    </section>
  )
}
