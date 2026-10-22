'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import {
  BUILD_CITIZENS_PANEL_MESSAGE,
  CIVIC_PANEL_PAGE_HREF,
  DASHBOARD_CARD_SNOOZE_DAYS,
  EXPLAIN_CIVIC_PANEL_MESSAGE,
  civicPanelBuildCardOpensPlan,
  isCivicPanelBuildCard,
  isCivicPanelStepCard,
  isGoodReadReportBackCard,
  isManagedCivicPanelCard,
  managedCivicPanelCardContent,
  START_MANAGED_CIVIC_PANEL_MESSAGE,
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
  useCompleteOnboardingCard,
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
import { civicPanelHref } from '../../contacts/citizens-panel/citizensPanelCopy'
import {
  MANAGED_PANEL_COPY,
  useServePlace,
} from '../../contacts/citizens-panel/managedPanelCopy'
import { ManagedPanelSeats } from '../../contacts/citizens-panel/components/ManagedPanelSeats'

// Same timing as the Campaign Manager's stack: the confetti bursts, then a
// done card lifts off the top while a skipped one drops down and out.
const CELEBRATE_MS = 500
const EXIT_MS = 300

const PRIMARY_ON_PHONE = 'w-full sm:w-auto'
// Grows from its own width rather than sharing the row equally, so a row with
// three quiet buttons wraps inside the card on a phone instead of running
// off its edge.
const QUIET_ON_PHONE =
  'max-sm:grow max-sm:h-8 max-sm:px-4 max-sm:py-2 max-sm:text-sm'
const QUIET_ROW_CLASS =
  'flex flex-wrap items-center gap-2 max-sm:mt-2 sm:contents'

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
  // The civic panel build card: it follows the meet card, closes itself once
  // its text has gone out, and its button opens the build chat whatever it
  // reads.
  buildsPanel: boolean
  // The build card, or the card for the panel plan's next step that takes
  // its place once it is done: same headline, same place in the deck.
  peopleFirst: boolean
  // A report back on a priority with a good read: it leads the panel cards.
  leadsPanel: boolean
  // The card that offers the civic panel GoodParty builds: its button opens
  // the Chief of Staff on the setup, and the seats fill above it.
  managedPanel: boolean
  // Tells the civic_panel cards apart in analytics.
  variant: CardVariant
}

type CardVariant =
  | 'panel_managed'
  | 'panel_build'
  | 'panel_step'
  | 'priority_next_step'
  | 'report_back'
  | 'other'

const cardVariant = (
  card: Parameters<typeof isCivicPanelBuildCard>[0],
): CardVariant => {
  if (isManagedCivicPanelCard(card)) return 'panel_managed'
  if (isCivicPanelBuildCard(card)) return 'panel_build'
  if (isCivicPanelStepCard(card)) return 'panel_step'
  if (card.type === 'civic_panel') return 'priority_next_step'
  if (card.type === 'report_back') return 'report_back'
  return 'other'
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
// sits between the two get-started cards.
const BUILD_PANEL_HEADLINE = 'People first'

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
  // Opens a fresh chat seeded with a hidden first message: one about the
  // front card, or the build card's explain turn.
  onDiscussCard?: (message: string) => void
  // True while a briefing is generating, so the empty state stays hidden.
  briefingInFlight?: boolean
}): React.JSX.Element | null => {
  const cards = useDashboardCards('active')
  const place = useServePlace()
  const { data: onboarding } = useOnboardingCards()
  const dismissCard = useDismissCard()
  const completeCard = useCompleteCard()
  const snoozeCard = useSnoozeCard()
  const skipOnboarding = useSkipOnboardingCard()
  const completeOnboarding = useCompleteOnboardingCard()
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
    // gp-api stores the managed card's words without the place; the home
    // names it.
    ...(isManagedCivicPanelCard(card)
      ? managedCivicPanelCardContent(place)
      : { title: card.title, summary: card.summary }),
    dueDate: card.dueDate,
    ctaLabel: card.ctaLabel,
    ctaHref:
      card.ctaHref === CIVIC_PANEL_PAGE_HREF
        ? civicPanelHref('chief_of_staff_home')
        : card.ctaHref,
    onboardingKey: null,
    // With a plan the build card links to it, so it starts no second build.
    buildsPanel:
      isCivicPanelBuildCard(card) && !civicPanelBuildCardOpensPlan(card),
    peopleFirst:
      isManagedCivicPanelCard(card) ||
      isCivicPanelBuildCard(card) ||
      isCivicPanelStepCard(card),
    leadsPanel: isGoodReadReportBackCard(card),
    managedPanel: isManagedCivicPanelCard(card),
    variant: cardVariant(card),
  }))
  const onboardingCards: DeckCard[] = ONBOARDING_CARD_ORDER.filter((key) =>
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
    peopleFirst: false,
    leadsPanel: false,
    managedPanel: false,
    variant: 'other' as const,
  }))
  // A new official meets their Chief of Staff before anything else, then
  // builds the panel, then sets priorities. A report back on a good read
  // leads the panel cards: there is something real to tell the people who
  // answered. Before that it waits with the rest.
  const deck: DeckCard[] = [
    ...onboardingCards.filter((card) => card.onboardingKey === 'meet'),
    ...dashboardCards.filter((card) => card.leadsPanel),
    ...dashboardCards.filter((card) => card.peopleFirst),
    ...onboardingCards.filter((card) => card.onboardingKey !== 'meet'),
    ...dashboardCards.filter((card) => !card.peopleFirst && !card.leadsPanel),
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
  const dueLine = front.peopleFirst ? null : formatDueDate(front.dueDate)

  const cardProps = {
    cardId: front.id,
    cardType: front.kind,
    cardVariant: front.variant,
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
      skipChoice: putOff ? 'snooze' : 'dismiss',
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
        {front.managedPanel
          ? MANAGED_PANEL_COPY.headline
          : front.peopleFirst
            ? BUILD_PANEL_HEADLINE
            : HEADLINES[front.kind]}
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
            {front.managedPanel ? <ManagedPanelSeats className="mb-4" /> : null}
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
                    if (!front.onboardingKey) return
                    if (front.onboardingKey === 'meet') {
                      completeOnboarding.mutate('meet')
                    }
                    onOpenCard(front.onboardingKey)
                  }}
                >
                  {front.ctaLabel}
                </Button>
              ) : onDiscussCard && front.managedPanel ? (
                <Button
                  type="button"
                  size="medium"
                  className={PRIMARY_ON_PHONE}
                  onClick={() => {
                    start()
                    onDiscussCard(START_MANAGED_CIVIC_PANEL_MESSAGE)
                  }}
                >
                  {front.ctaLabel}
                </Button>
              ) : onDiscussCard && front.buildsPanel ? (
                <Button
                  type="button"
                  size="medium"
                  className={PRIMARY_ON_PHONE}
                  onClick={() => {
                    start()
                    onDiscussCard(BUILD_CITIZENS_PANEL_MESSAGE)
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
              <div className={QUIET_ROW_CLASS} data-testid="task-card-actions">
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
                    conversation from their own button, but the managed
                    panel's button opens its setup, not a question. */}
                {onDiscussCard &&
                  !front.onboardingKey &&
                  (front.kind !== 'civic_panel' || front.managedPanel) && (
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
                {/* Explains the panel before asking for it: the chat builds
                    nothing unless the official says yes. */}
                {onDiscussCard && front.buildsPanel && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="medium"
                    className={QUIET_ON_PHONE}
                    onClick={() => {
                      trackEvent(EVENTS.ChiefOfStaff.TaskActionTaken, {
                        ...cardProps,
                        action: 'explain',
                      })
                      onDiscussCard(EXPLAIN_CIVIC_PANEL_MESSAGE)
                    }}
                  >
                    What&apos;s a civic panel?
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
