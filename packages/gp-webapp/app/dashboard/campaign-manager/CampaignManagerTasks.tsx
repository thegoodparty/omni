'use client'

import { format, parseISO } from 'date-fns'
import ManagerPromptCard from './ManagerPromptCard'
import { useTrackerTasks } from '../campaign-plan/components/campaignStrategy/useTrackerTasks'
import {
  trackTaskAction,
  useCompleteTrackerTask,
} from '../campaign-plan/components/campaignStrategy/useCompleteTrackerTask'
import TaskCard from '../chief-of-staff/components/TaskCard'
import GetOnBallotCard from './GetOnBallotCard'
import PersonalizeStoryCard from './PersonalizeStoryCard'
import StoryReadyCard from './StoryReadyCard'
import {
  composeOutreachHref,
  parseTrackerOrigin,
  type ComposeFlowType,
} from 'app/dashboard/outreach/util/composeOutreachHref.util'
import { selectTopDynamicTasks } from './selectTopDynamicTasks'

// Fallback when a task has no action link of its own.
const TRACKER_HREF = '/dashboard/campaign-plan'

// A task's own action link, if it has a non-empty one. Trimmed so an empty or
// whitespace string (which the agent can emit) counts as "no link" rather than
// rendering a broken href, matching the tracker, which hides the link then.
const taskLink = (task: { link: string | null }): string | null =>
  task.link?.trim() ? task.link : null

// Text/robocall tasks link into the outreach hub with the due date bound
// (mirrors the tracker rows); everything else falls back to the tracker page.
const composeFlowType = (task: {
  link: string | null
  flowType: string | null
}): ComposeFlowType | null => {
  if (taskLink(task)) return null
  return task.flowType === 'text' || task.flowType === 'robocall'
    ? task.flowType
    : null
}

// Each card links to the task's own action, falling back to the tracker page.
// Compose (text/robocall) tasks link into the outreach hub, which opens the
// channel's flow behind its own gate.
const taskHref = (task: {
  id: string
  link: string | null
  flowType: string | null
  date: string | null
  phase: string | null
}): string | undefined => {
  const own = taskLink(task)
  if (own) return own
  const composeType = composeFlowType(task)
  return composeType
    ? composeOutreachHref(
        composeType,
        'campaign_manager',
        task.date,
        // The same tracker task the campaign plan links, so an arrival from
        // either surface joins its outreach and Pro upgrade events to it.
        parseTrackerOrigin(task.id, task.phase),
      )
    : TRACKER_HREF
}

// Overline label per tracker flowType (same set buildTrackerStrategy maps to
// channels). Unknown/static rows fall back to a generic priority label.
const FLOW_TYPE_LABELS: Record<string, string> = {
  text: 'Messaging',
  robocall: 'Robocall',
  phoneBanking: 'Phone banking',
  doorKnocking: 'Door knocking',
  events: 'Event',
  awareness: 'Awareness',
}
const taskLabel = (flowType: string | null): string =>
  (flowType && FLOW_TYPE_LABELS[flowType]) || 'Priority'

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

  // The same completion path and events as Home's next-task card, so both
  // arms of `next-task-experience` report completions in one series.
  const { onToggleComplete, countModal } = useCompleteTrackerTask(tasks, {
    source: 'campaign_manager',
  })

  return (
    <section className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 py-6">
      {showMeetCard && (
        <ManagerPromptCard
          card="meet_manager"
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
              const composeType = composeFlowType(task)
              // With its own action link, "Open" it (like the tracker);
              // text/robocall start the outreach flow; otherwise route to
              // the tracker to act on it there.
              const ctaLabel =
                task.cta?.trim() ||
                (taskLink(task)
                  ? 'Open'
                  : composeType
                    ? 'Start outreach'
                    : 'See details')
              return (
                <TaskCard
                  key={task.id}
                  overlineLabel={taskLabel(task.flowType)}
                  title={task.title}
                  meta={[formatDue(task.date)]}
                  summary={task.description || undefined}
                  ctaLabel={ctaLabel}
                  ctaHref={taskHref(task)}
                  // Same event and shape as Home's next-task card, so CTA
                  // clicks compare across both arms of the experiment.
                  onCta={() =>
                    trackTaskAction(task, 'start', 'campaign_manager', ctaLabel)
                  }
                  onComplete={() => onToggleComplete(task.id, true)}
                  // Only the top priority card gets the subtle gradient.
                  gradient={index === 0}
                />
              )
            })}
          </div>
        )}
      </div>

      {countModal}
    </section>
  )
}
