'use client'

import { format, parseISO } from 'date-fns'
import { Button } from '@styleguide'
import {
  CalendarDaysIcon,
  CalendarIcon,
  MapPinIcon,
  MessageSquareIcon,
  PhoneIcon,
  SparklesIcon,
} from '@styleguide/components/ui/icons'
import type { LucideIcon } from 'lucide-react'
import { useTrackerTasks } from '../campaign-plan/components/campaignStrategy/useTrackerTasks'
import TaskCard from '../chief-of-staff/components/TaskCard'
import { useChatHistory } from '../chief-of-staff/data/use-chat-history'
import { selectTopDynamicTasks } from './selectTopDynamicTasks'
import {
  CAMPAIGN_MANAGER_HISTORY_KEY,
  campaignManagerChatApi,
} from './campaignManagerChat'

// Fallback when a task has no action link of its own.
const TRACKER_HREF = '/dashboard/campaign-plan'

// A task's own action link, if it has a non-empty one. Trimmed so an empty or
// whitespace string (which the agent can emit) counts as "no link" rather than
// rendering a broken href — matching the tracker, which hides the link then.
const taskLink = (task: { link: string | null }): string | null =>
  task.link?.trim() ? task.link : null

// Each card links to the task's own action, falling back to the tracker page.
const taskHref = (task: { link: string | null }): string =>
  taskLink(task) ?? TRACKER_HREF

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
  onMeetManager: () => void
}

export default function CampaignManagerTasks({
  onMeetManager,
}: Props): React.JSX.Element {
  const { tasks, isPending, isError, isGeneratingDynamic } = useTrackerTasks()
  const top = selectTopDynamicTasks(tasks)

  // First-run onboarding card: show it only once we know the candidate has
  // never opened the manager (no conversation yet). Opening it eagerly creates
  // one, so the card drops away afterward. Gate on the loaded-and-empty state so
  // a returning candidate never sees it flash while history loads.
  const { data: conversations } = useChatHistory(
    true,
    campaignManagerChatApi,
    CAMPAIGN_MANAGER_HISTORY_KEY,
  )
  const showMeetCard = conversations !== undefined && conversations.length === 0

  return (
    <section className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 py-6">
      {showMeetCard && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold">Your campaign manager</h1>
            <p className="text-sm text-muted-foreground">
              The two or three things that matter most this week, and a manager
              to help you decide what to do next.
            </p>
          </div>
          <Button className="self-start" onClick={onMeetManager}>
            Meet your campaign manager
          </Button>
        </div>
      )}

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
            We are preparing your personalized tasks. Check back in a few
            minutes.
          </p>
        ) : top.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tasks to show yet. Your manager will surface priorities as your
            plan develops.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {top.map((task) => {
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
                  // otherwise route to the tracker to act on it there.
                  ctaLabel={
                    task.cta?.trim() ||
                    (taskLink(task) ? 'Open' : 'See details')
                  }
                  ctaHref={taskHref(task)}
                />
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
