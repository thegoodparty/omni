'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import {
  DASHBOARD_CARD_SNOOZE_DAYS,
  isCivicPanelBuildCard,
} from '@goodparty_org/contracts'
import { format, parseISO } from 'date-fns'
import {
  Button,
  CalendarIcon,
  Card,
  CheckIcon,
  ConfettiBurst,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ExternalLinkIcon,
  MessagesSquareIcon,
  cn,
} from '@styleguide'
import {
  useCompleteCard,
  useDashboardCards,
  useDismissCard,
  useOnboardingCards,
  useSkipOnboardingCard,
  useSnoozeCard,
} from '../data/use-dashboard'
import {
  ONBOARDING_CARDS,
  ONBOARDING_CARD_ORDER,
} from './onboardingCardsConfig'
import type { DashboardCardType, OnboardingCardKey } from '../data/contracts'

// Same timing as the Campaign Manager's stack: the confetti bursts, then a
// done card lifts off the top while a skipped one drops down and out.
const CELEBRATE_MS = 500
const EXIT_MS = 300

const PRIMARY_ON_PHONE = 'w-full sm:w-auto'
const QUIET_ON_PHONE =
  'max-sm:flex-1 max-sm:h-8 max-sm:px-4 max-sm:py-2 max-sm:text-sm'

type DeckKind = 'onboarding' | DashboardCardType

type DeckCard = {
  id: string
  kind: DeckKind
  title: string
  summary: string
  dueDate: string | null
  ctaLabel: string
  // Onboarding cards open the chat instead of navigating.
  ctaHref: string | null
  onboardingKey: OnboardingCardKey | null
  // The civic panel build card: it leads the deck, and closes itself
  // once its text has gone out.
  buildsPanel: boolean
}

const HEADLINES: Record<DeckKind, string> = {
  onboarding: 'Start here',
  briefing: 'Get ready for your next meeting',
  agenda_item: 'Know what is on the agenda',
  community_issue: 'Hear what your community is saying',
  civic_panel: 'Next steps on your priorities',
  report_back: 'Tell people what you heard',
}

// The build card shares its type with the per-priority panel cards, and
// leads the deck ahead of the get-started cards.
const BUILD_PANEL_HEADLINE = 'Start here'

const isExternalHref = (href: string): boolean =>
  /^(https?:)?\/\//.test(href) ||
  href.startsWith('mailto:') ||
  href.startsWith('tel:')

const formatDueDate = (iso: string | null): string | null => {
  if (!iso) return null
  try {
    return format(parseISO(iso), 'EEEE, MMMM d')
  } catch {
    return null
  }
}

// Sent as the official's first message, so the chief of staff answers about
// this task instead of opening on its greeting. Same shape as the Campaign
// Manager's discussTaskMessage.
const discussCardMessage = (card: DeckCard, dueLine: string | null): string =>
  [
    `Help me with this task from my dashboard: "${card.title}".`,
    card.summary,
    dueLine ? `It is due ${dueLine}.` : '',
  ]
    .filter(Boolean)
    .join(' ')

/**
 * The Serve home's one thing to do: the get-started cards, then the week's
 * task cards by due date, as a stack with only the front card actionable.
 */
const TaskStack = ({
  onOpenCard,
  onDiscussCard,
  briefingInFlight = false,
}: {
  onOpenCard: (key: OnboardingCardKey) => void
  // Opens a fresh chat seeded with a message about the front card.
  onDiscussCard?: (message: string) => void
  // True while a briefing is generating, so the empty state stays hidden.
  briefingInFlight?: boolean
}): React.JSX.Element | null => {
  const cards = useDashboardCards('active')
  const { data: onboarding } = useOnboardingCards()
  const dismissCard = useDismissCard()
  const completeCard = useCompleteCard()
  const snoozeCard = useSnoozeCard()
  const skipOnboarding = useSkipOnboardingCard()
  // The card just finished or skipped. It has already left the query data, so
  // it is held here and stays in front until it has finished leaving.
  const [leaving, setLeaving] = useState<{
    card: DeckCard
    stage: 'celebrate' | 'exit'
    direction: 'up' | 'down'
  } | null>(null)
  const [arriving, setArriving] = useState(false)

  useEffect(() => {
    if (!leaving) return
    const timer = window.setTimeout(
      () => {
        if (leaving.stage === 'celebrate') {
          setLeaving({ ...leaving, stage: 'exit' })
          return
        }
        setLeaving(null)
        setArriving(true)
      },
      leaving.stage === 'celebrate' ? CELEBRATE_MS : EXIT_MS,
    )
    return () => window.clearTimeout(timer)
  }, [leaving])

  const dashboardCards: DeckCard[] = (cards.data ?? []).map((card) => ({
    id: card.id,
    kind: card.type,
    title: card.title,
    summary: card.summary,
    dueDate: card.dueDate,
    ctaLabel: card.ctaLabel,
    ctaHref: card.ctaHref,
    onboardingKey: null,
    buildsPanel: isCivicPanelBuildCard(card),
  }))
  const deck: DeckCard[] = [
    ...dashboardCards.filter((card) => card.buildsPanel),
    ...ONBOARDING_CARD_ORDER.filter((key) =>
      onboarding?.some((c) => c.key === key && c.status === 'active'),
    ).map((key) => ({
      id: `onboarding:${key}`,
      kind: 'onboarding' as const,
      title: ONBOARDING_CARDS[key].title,
      summary: ONBOARDING_CARDS[key].summary,
      dueDate: null,
      ctaLabel: ONBOARDING_CARDS[key].ctaLabel,
      ctaHref: null,
      onboardingKey: key,
      buildsPanel: false,
    })),
    ...dashboardCards.filter((card) => !card.buildsPanel),
  ]
  const stack = leaving
    ? [leaving.card, ...deck.filter((card) => card.id !== leaving.card.id)]
    : deck
  const front = stack[0]
  const layersBehind = Math.min(stack.length - 1, 2)

  if (cards.isPending || onboarding === undefined) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="task-list-loading"
      >
        Loading your tasks...
      </p>
    )
  }

  if (cards.isError && !front) {
    return (
      <p className="text-sm text-muted-foreground">
        We could not load your tasks right now.
      </p>
    )
  }

  if (!front) {
    // The briefing banner sits above. A briefing generating IS work in
    // progress, so an empty state beside it reads as a contradiction.
    if (briefingInFlight) return null
    return (
      <EmptyState
        data-testid="task-list-empty"
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) setArriving(false)
        }}
        className={cn(
          'rounded-2xl border-components-input-border',
          arriving &&
            'animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-300 motion-reduce:animate-none',
        )}
        title="No tasks this week"
        message="Ask your chief of staff what is worth moving."
      />
    )
  }

  // The build card's due date only keeps it from sitting forever; it is not
  // a deadline the official has.
  const dueLine = front.buildsPanel ? null : formatDueDate(front.dueDate)

  const cardProps = {
    cardId: front.id,
    cardType: front.kind,
    stackSize: deck.length,
  }
  const start = () =>
    trackEvent(EVENTS.ChiefOfStaff.TaskActionTaken, {
      ...cardProps,
      action: 'start',
      cta: front.ctaLabel,
    })
  const markDone = () => {
    trackEvent(EVENTS.ChiefOfStaff.TaskCompleted, cardProps)
    setLeaving({ card: front, stage: 'celebrate', direction: 'up' })
    completeCard.mutate(front.id)
  }
  const skip = (putOff = false) => {
    trackEvent(EVENTS.ChiefOfStaff.TaskActionTaken, {
      ...cardProps,
      action: 'skip',
    })
    setLeaving({ card: front, stage: 'exit', direction: 'down' })
    if (front.onboardingKey) skipOnboarding.mutate(front.onboardingKey)
    else if (putOff) snoozeCard.mutate(front.id)
    else dismissCard.mutate(front.id)
  }
  const skipClassName = cn(QUIET_ON_PHONE, 'sm:ml-auto')
  const offersMarkDone = !front.onboardingKey && front.kind !== 'civic_panel'

  return (
    <section className="flex w-full flex-col gap-6">
      <h2 className="text-center text-2xl font-semibold text-foreground">
        {front.buildsPanel ? BUILD_PANEL_HEADLINE : HEADLINES[front.kind]}
      </h2>
      <div
        className={cn(
          'relative w-full',
          layersBehind === 2 && 'pb-4',
          layersBehind === 1 && 'pb-2',
        )}
      >
        {layersBehind === 2 && (
          <Card
            aria-hidden
            className="absolute inset-x-6 top-4 bottom-0 rounded-2xl border-components-input-border py-0"
          />
        )}
        {layersBehind >= 1 && (
          <Card
            aria-hidden
            className={cn(
              'absolute inset-x-3 top-2 rounded-2xl border-components-input-border py-0',
              layersBehind === 2 ? 'bottom-2' : 'bottom-0',
            )}
          />
        )}
        <Card
          key={front.id}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) setArriving(false)
          }}
          className={cn(
            'relative min-h-20 gap-0 rounded-2xl border-components-input-border py-0',
            leaving && 'pointer-events-none',
            leaving?.stage === 'exit' &&
              'animate-out fade-out fill-mode-forwards duration-300 motion-reduce:animate-none',
            leaving?.stage === 'exit' &&
              (leaving.direction === 'up'
                ? 'slide-out-to-top-8'
                : 'slide-out-to-bottom-8'),
            !leaving &&
              arriving &&
              'animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-300 motion-reduce:animate-none',
          )}
        >
          <div className="flex flex-col gap-1 px-6 py-5">
            {/* No overline: the title leads. See design-memory learned.md. */}
            <h3 className="font-opensans text-lg font-medium text-card-foreground">
              {front.title}
            </h3>
            <p className="text-sm text-muted-foreground">{front.summary}</p>
            {dueLine && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <CalendarIcon className="size-4 shrink-0" aria-hidden />
                {dueLine}
              </p>
            )}
            <div className="flex flex-col gap-2 pt-5 sm:flex-row sm:flex-wrap sm:items-center">
              {front.onboardingKey ? (
                <Button
                  type="button"
                  size="medium"
                  className={PRIMARY_ON_PHONE}
                  onClick={() => {
                    start()
                    if (front.onboardingKey) onOpenCard(front.onboardingKey)
                  }}
                >
                  {front.ctaLabel}
                </Button>
              ) : (
                front.ctaHref && (
                  <Button asChild size="medium" className={PRIMARY_ON_PHONE}>
                    {isExternalHref(front.ctaHref) ? (
                      <a
                        href={front.ctaHref}
                        target="_blank"
                        rel="noreferrer"
                        onClick={start}
                      >
                        {front.ctaLabel}
                        <ExternalLinkIcon className="size-4" aria-hidden />
                      </a>
                    ) : (
                      <Link href={front.ctaHref} onClick={start}>
                        {front.ctaLabel}
                      </Link>
                    )}
                  </Button>
                )
              )}
              <div className="flex items-center gap-2 max-sm:mt-2 sm:contents">
                {/* Get-started and civic panel cards close themselves once
                    their goal is met (a priority card, once the priority is
                    resolved), so they offer no manual Mark done. */}
                {offersMarkDone && (
                  <Button
                    type="button"
                    variant="outline"
                    size="medium"
                    className={QUIET_ON_PHONE}
                    onClick={markDone}
                  >
                    <ConfettiBurst
                      play={
                        leaving?.card.id === front.id &&
                        leaving.direction === 'up'
                      }
                      style={{ width: 16, height: 16 }}
                    >
                      <CheckIcon className="size-4" aria-hidden />
                    </ConfettiBurst>
                    Mark done
                  </Button>
                )}
                {/* Get-started and civic panel cards already open a
                    conversation from their own button. */}
                {onDiscussCard &&
                  !front.onboardingKey &&
                  front.kind !== 'civic_panel' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="medium"
                      className={QUIET_ON_PHONE}
                      onClick={() => {
                        trackEvent(EVENTS.ChiefOfStaff.TaskActionTaken, {
                          ...cardProps,
                          action: 'ask',
                        })
                        onDiscussCard(discussCardMessage(front, dueLine))
                      }}
                    >
                      {/* On the narrowest phones a third quiet button leaves
                        no room for the icon. */}
                      <MessagesSquareIcon
                        className={cn(
                          'size-4',
                          offersMarkDone && 'max-[399px]:hidden',
                        )}
                        aria-hidden
                      />
                      Ask about this
                    </Button>
                  )}
                {!leaving &&
                  (front.kind === 'civic_panel' ||
                  front.kind === 'report_back' ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="medium"
                          className={skipClassName}
                        >
                          Skip
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => skip(true)}>
                          Show in {DASHBOARD_CARD_SNOOZE_DAYS} days
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => skip()}>
                          Not for me
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="medium"
                      className={skipClassName}
                      onClick={() => skip()}
                    >
                      Skip
                    </Button>
                  ))}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </section>
  )
}

export default TaskStack
