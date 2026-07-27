'use client'

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import ManagerPromptCard from './ManagerPromptCard'
import {
  CalendarDaysIcon,
  CalendarIcon,
  MapPinIcon,
  MessageSquareIcon,
  PhoneIcon,
  SparklesIcon,
} from '@styleguide/components/ui/icons'
import type { LucideIcon } from 'lucide-react'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import {
  isVoterContactFlowType,
  useToggleTrackerTaskComplete,
  useTrackerTasks,
} from '../campaign-plan/components/campaignStrategy/useTrackerTasks'
import TaskCard from '../chief-of-staff/components/TaskCard'
import PersonalizeStoryCard from './PersonalizeStoryCard'
import StoryReadyCard from './StoryReadyCard'
import {
  type ComposeFlowType,
  useOutreachComposeFlow,
} from 'app/dashboard/outreach/hooks/useOutreachComposeFlow'
import CountModal from '../components/tasks/CountModal'
import { selectTopDynamicTasks } from './selectTopDynamicTasks'

// Fallback when a task has no action link of its own.
const TRACKER_HREF = '/dashboard/campaign-plan'

// A task's own action link, if it has a non-empty one. Trimmed so an empty or
// whitespace string (which the agent can emit) counts as "no link" rather than
// rendering a broken href, matching the tracker, which hides the link then.
const taskLink = (task: { link: string | null }): string | null =>
  task.link?.trim() ? task.link : null

// Text/robocall tasks open the outreach flow in place with the due date bound
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
// Compose (text/robocall) tasks return undefined: their CTA opens the outreach
// flow in place via onCta instead of navigating.
const taskHref = (task: {
  link: string | null
  flowType: string | null
}): string | undefined => {
  const own = taskLink(task)
  if (own) return own
  return composeFlowType(task) ? undefined : TRACKER_HREF
}

// Eyebrow label + icon per tracker flowType (same set buildTrackerStrategy maps
// to channels). Unknown/static rows fall back to a generic priority label.
const FLOW_TYPE_META: Record<string, { label: string; Icon: LucideIcon }> = {
  text: { label: 'Messaging', Icon: MessageSquareIcon },
  robocall: { label: 'Robocall', Icon: PhoneIcon },
  phoneBanking: { label: 'Phone banking', Icon: PhoneIcon },
  doorKnocking: { label: 'Door knocking', Icon: MapPinIcon },
  events: { label: 'Event', Icon: CalendarIcon },
  awareness: { label: 'Awareness', Icon: CalendarDaysIcon },
}
const DEFAULT_META = { label: 'Priority', Icon: SparklesIcon }
const taskMeta = (
  flowType: string | null,
): { label: string; Icon: LucideIcon } =>
  (flowType && FLOW_TYPE_META[flowType]) || DEFAULT_META

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
}

export default function CampaignManagerTasks({
  showMeetCard,
  onMeetManager,
  onSkipMeet,
  onPersonalize,
}: Props): React.JSX.Element {
  const { tasks, isPending, isError, isGeneratingDynamic } = useTrackerTasks()
  const top = selectTopDynamicTasks(tasks)

  const toggleComplete = useToggleTrackerTaskComplete()
  const { open: openOutreachFlow, flowNode: outreachFlowNode } =
    useOutreachComposeFlow('campaign_manager')
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
              const composeType = composeFlowType(task)
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
                  ctaLabel={
                    task.cta?.trim() ||
                    (taskLink(task)
                      ? 'Open'
                      : composeType
                        ? 'Start outreach'
                        : 'See details')
                  }
                  ctaHref={taskHref(task)}
                  onCta={
                    composeType
                      ? () => openOutreachFlow(composeType, task.date)
                      : undefined
                  }
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

      {outreachFlowNode}

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
