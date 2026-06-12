'use client'

import { Skeleton } from '@styleguide'
import { VoterDemographicsStep } from 'app/onboarding/components/VoterDemographicsStep'
import PlanSectionNav, { type PlanSectionRef } from './PlanSectionNav'
import type { PlanData, TimelineStage } from './planContent'
import {
  getNumberedPlanSections,
  type PlanSectionKey,
} from '../planSectionManifest'

export interface StrategyState {
  isGenerating: boolean
  isError: boolean
}

// Same shape as StrategyState — the polling hooks both produce it.
// Kept as a distinct alias so the prop intent at call sites is clear and
// so we can diverge later if events need an additional flag (e.g.
// "no results found" vs "generating").
export type EventsState = StrategyState

// Same shape as StrategyState for the local-news (press outlets) pipeline.
export type PressOutletsState = StrategyState

export interface VoterInsightsContext {
  ballotReadyPositionId?: string
  city?: string
  state?: string
  office?: string
}

interface PlanSectionsProps {
  plan: PlanData
  strategyState?: StrategyState
  eventsState?: EventsState
  pressOutletsState?: PressOutletsState
  onStuckChange?: (stuck: boolean) => void
  voterInsightsContext?: VoterInsightsContext
  navStuckClassName?: string
}

interface SectionProps {
  id: string
  number: number
  title: string
  children: React.ReactNode
  transition?: React.ReactNode
}

const Section = ({
  id,
  number,
  title,
  children,
  transition,
}: SectionProps): React.JSX.Element => (
  <section id={id} className="scroll-mt-24">
    <header className="mb-2 space-y-2">
      <p className="text-xs font-semibold tracking-widest text-components-input-active uppercase">
        Section {number}
      </p>
      <h2 className="text-2xl font-bold text-foreground sm:text-3xl">
        {title}
      </h2>
    </header>
    <div className="space-y-6 text-left">{children}</div>
    {transition ? (
      <>
        <hr className="mt-8 border-t border-base-border" />
        <p className="mt-8 text-sm text-muted-foreground">{transition}</p>
      </>
    ) : null}
  </section>
)

// Stable DOM anchors for each section, keyed by the shared manifest. These
// ids never change with display numbering — only the visible "Section N"
// label and nav number come from the manifest.
const SECTION_DOM_ID: Record<PlanSectionKey, string> = {
  executiveSummary: 'plan-section-1',
  strategicLandscape: 'plan-section-2',
  electoralGoals: 'plan-section-3',
  voterInsights: 'plan-section-4',
  resources: 'plan-section-5',
  timeline: 'plan-section-6',
  community: 'plan-section-7',
  voterContact: 'plan-section-8',
  measurement: 'plan-section-9',
  methodology: 'plan-section-10',
  glossary: 'plan-section-11',
}

interface SubsectionProps {
  title: string
  children: React.ReactNode
}

const Subsection = ({
  title,
  children,
}: SubsectionProps): React.JSX.Element => (
  <div className="space-y-2">
    <h3 className="text-lg font-semibold text-foreground">{title}</h3>
    <div className="space-y-3 text-sm text-foreground">{children}</div>
  </div>
)

interface DefinitionListProps {
  items: { title: string; body: string }[]
}

const DefinitionList = ({ items }: DefinitionListProps): React.JSX.Element => (
  <ul className="space-y-1.5 text-sm">
    {items.map((item) => (
      <li key={item.title}>
        <span className="font-semibold text-foreground">{item.title}</span>{' '}
        <span className="text-muted-foreground">{item.body}</span>
      </li>
    ))}
  </ul>
)

interface PlanTableProps {
  columns: string[]
  rows: (string | React.ReactNode)[][]
}

const PlanTable = ({ columns, rows }: PlanTableProps): React.JSX.Element => (
  <div className="overflow-x-auto rounded-xl border border-base-border">
    <table className="w-full text-left text-sm">
      <thead className="bg-muted">
        <tr>
          {columns.map((col) => (
            <th key={col} className="px-4 py-3 font-semibold text-foreground">
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-base-border">
        {rows.map((row, rIdx) => (
          <tr key={rIdx}>
            {row.map((cell, cIdx) => (
              <td key={cIdx} className="px-4 py-3 align-top text-foreground">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

// "The Race" subsection has 3 variants per the source doc: no opponents,
// ≥1 opponent (no incumbent), and ≥1 opponent with incumbent.
const TheRaceCopy = ({ plan }: { plan: PlanData }): React.JSX.Element => {
  const districtFragment = plan.hasDistrict ? (
    <>
      {' '}
      in{' '}
      <span className="font-semibold text-foreground">{plan.districtName}</span>
    </>
  ) : null

  const opener = (
    <>
      You&apos;re running for{' '}
      <span className="font-semibold text-foreground">{plan.race}</span>
      {districtFragment}. As of{' '}
      <span className="font-semibold text-foreground">
        {plan.planGenerationDate}
      </span>
      ,{' '}
    </>
  )

  const electionDay = (
    <>
      Election Day is{' '}
      <span className="font-semibold text-foreground">{plan.electionDate}</span>
      .
    </>
  )

  if (plan.opponentCount === 0) {
    return (
      <p>
        {opener}no one else has entered, so right now you&apos;re the only
        candidate. We&apos;ll update this the moment that changes. {electionDay}
      </p>
    )
  }

  const opponentFragment = (
    <span className="font-semibold text-foreground">
      {plan.opponentCount} other{' '}
      {plan.opponentCount === 1 ? 'person is' : 'people are'} running
    </span>
  )

  if (plan.incumbent) {
    return (
      <p>
        {opener}
        {opponentFragment}, including{' '}
        <span className="font-semibold text-foreground">
          {plan.incumbent.fullName}
        </span>
        , who holds the seat now. Someone already in office starts out better
        known, so your job is to give voters one clear reason to pick you
        instead. {electionDay}
      </p>
    )
  }

  return (
    <p>
      {opener}
      {opponentFragment}, and none of them holds the seat now, so
      everyone&apos;s starting on even footing. {electionDay}
    </p>
  )
}

// "Who You're Running Against" has 3 variants based on opponent count and
// filing-window availability.
const WhoYoureRunningAgainst = ({
  plan,
}: {
  plan: PlanData
}): React.JSX.Element => {
  if (plan.opponentCount === 0) {
    if (plan.filingDateStart && plan.filingDateEnd) {
      return (
        <p>
          People can start filing on{' '}
          <span className="font-semibold text-foreground">
            {plan.filingDateStart}
          </span>
          , and the window closes on{' '}
          <span className="font-semibold text-foreground">
            {plan.filingDateEnd}
          </span>
          . Until then we won&apos;t know for sure who&apos;s on the ballot, so
          we&apos;ll keep checking and add them here as they enter.
        </p>
      )
    }
    if (plan.filingDateEnd) {
      return (
        <p>
          The filing window for this race closes on{' '}
          <span className="font-semibold text-foreground">
            {plan.filingDateEnd}
          </span>
          . We won&apos;t know for sure who&apos;s on the ballot until then, so
          we&apos;ll keep checking and add anyone who files here.
        </p>
      )
    }
    return (
      <p>
        No one&apos;s officially entered yet. We&apos;ll keep checking and add
        anyone who files to run against you. If you hear about someone before we
        do, just tell us in Campaign Manager.
      </p>
    )
  }

  return (
    <>
      <p>
        Here&apos;s who else is running. Knowing their background and what they
        tend to run on helps you decide where to draw a clear contrast and where
        to skip a fight you can&apos;t win.
      </p>
      <ul className="space-y-6 text-sm">
        {plan.opponents.map((opp) => (
          <li key={opp.fullName} className="space-y-2">
            <p className="font-semibold text-foreground">{opp.fullName}</p>
            <ul className="space-y-1 pl-5 text-muted-foreground [list-style:disc]">
              {opp.partyAffiliation ? (
                <li>Party: {opp.partyAffiliation}</li>
              ) : null}
              {opp.incumbent === true ? <li>Holds the seat now: Yes</li> : null}
            </ul>
          </li>
        ))}
      </ul>
    </>
  )
}

// Renders the Section 7 events table as a skeleton while the
// community-events endpoint is polling. Three skeleton rows match the
// MAX_EVENTS = 3 contract on the server so the layout shift on swap-in
// is minimal.
const CommunityEventsSkeleton = (): React.JSX.Element => (
  <>
    <p className="text-sm text-muted-foreground italic">
      Generating local community events&hellip; this can take up to a minute.
    </p>
    <div className="space-y-3">
      <Skeleton className="h-14 w-full rounded-md" />
      <Skeleton className="h-14 w-full rounded-md" />
      <Skeleton className="h-14 w-full rounded-md" />
    </div>
  </>
)

// Renders the Section 7 press table as a skeleton while the local-news
// endpoint is polling. Mirrors CommunityEventsSkeleton so the two Section 7
// subsections feel consistent during loading.
const PressOutletsSkeleton = (): React.JSX.Element => (
  <>
    <p className="text-sm text-muted-foreground italic">
      Identifying local press &amp; media outlets&hellip; this can take up to a
      minute.
    </p>
    <div className="space-y-3">
      <Skeleton className="h-14 w-full rounded-md" />
      <Skeleton className="h-14 w-full rounded-md" />
      <Skeleton className="h-14 w-full rounded-md" />
    </div>
  </>
)

// Skeleton for "Who You're Running Against" while the strategic-landscape
// endpoint (the highest-priority opponent source) is still polling.
const OpponentsSkeleton = (): React.JSX.Element => (
  <>
    <p className="text-sm text-muted-foreground italic">
      Checking who else is running&hellip; this can take up to a minute.
    </p>
    <div className="space-y-3">
      <Skeleton className="h-5 w-48 rounded-md" />
      <Skeleton className="h-4 w-full rounded-md" />
      <Skeleton className="h-4 w-5/6 rounded-md" />
    </div>
  </>
)

const BulletList = ({ items }: { items: string[] }): React.JSX.Element => (
  <ul className="space-y-1.5 pl-5 text-sm text-muted-foreground [list-style:disc]">
    {items.map((item) => (
      <li key={item}>{item}</li>
    ))}
  </ul>
)

// Section 6 renders as a visual timeline: a vertical rail per stage with a
// dot per milestone. The list is the content; the rail is the format.
const TimelineStageBlock = ({
  stage,
  index,
}: {
  stage: TimelineStage
  index: number
}): React.JSX.Element => (
  <div className="space-y-3">
    <h3 className="text-lg font-semibold text-foreground">
      Stage {index + 1} / {stage.stage}
    </h3>
    <ol className="ml-1.5 space-y-6 border-l-2 border-base-border pl-6">
      {stage.items.map((item) => (
        <li key={`${item.date}-${item.milestone}`} className="relative">
          <span
            aria-hidden="true"
            className="absolute top-1 -left-6 size-2.5 -translate-x-1/2 rounded-full bg-components-input-active"
          />
          <p className="text-sm font-semibold text-foreground">{item.date}</p>
          <p className="text-sm text-foreground">{item.milestone}</p>
          {item.notes ? (
            <p className="text-xs text-muted-foreground">{item.notes}</p>
          ) : null}
        </li>
      ))}
    </ol>
  </div>
)

const districtLabel = (plan: PlanData): string =>
  plan.hasDistrict ? plan.districtName : 'your area'

const PlanSections = ({
  plan,
  strategyState,
  eventsState,
  pressOutletsState,
  onStuckChange,
  voterInsightsContext,
  navStuckClassName,
}: PlanSectionsProps): React.JSX.Element => {
  const isStrategyGenerating = strategyState?.isGenerating ?? false
  const isEventsGenerating = eventsState?.isGenerating ?? false
  const isEventsError = eventsState?.isError ?? false
  const isPressOutletsGenerating = pressOutletsState?.isGenerating ?? false
  const isPressOutletsError = pressOutletsState?.isError ?? false
  // Every section always renders — Sizing Up Your Race is templated from
  // race data, so there's no LLM dependency that could empty it. The
  // strategy endpoint only refines the opponent roster (skeleton below).
  const numberedSections = getNumberedPlanSections(true)
  const numberFor = (key: PlanSectionKey): number =>
    numberedSections.find((s) => s.key === key)?.number ?? 0
  const titleFor = (key: PlanSectionKey): string =>
    numberedSections.find((s) => s.key === key)?.title ?? ''
  const navSections: PlanSectionRef[] = numberedSections.map((s) => ({
    id: SECTION_DOM_ID[s.key],
    label: `${s.number}. ${s.title}`,
  }))

  return (
    // The [&_li]/[&_ul] utilities restore bullet rendering inside the
    // dashboard shell: globals.css applies `[data-slot] li { display: flex }`
    // (a flex li renders no ::marker) and `[data-slot] ul { list-style-type:
    // none; padding-inline-start: 0 }` to everything under the sidebar's
    // data-slot wrapper. Plain plan lists (Campaign Plan at a Glance, Key
    // Dates) rely on base-layer list defaults, so they need the explicit
    // disc + padding here too. These utilities win over the base-layer reset
    // and match how the same content renders on the onboarding success page.
    // The section nav's Select portals out of this subtree, so it is
    // unaffected, and no styleguide component renders a ul in this tree.
    <div className="text-left [&_li]:list-item [&_ul]:list-disc [&_ul]:pl-5">
      <PlanSectionNav
        sections={navSections}
        onStuckChange={onStuckChange}
        stuckClassName={navStuckClassName}
      />

      <div className="mt-8 space-y-12">
        {/* 1. Welcome to Your Campaign */}
        <Section
          id="plan-section-1"
          number={numberFor('executiveSummary')}
          title={titleFor('executiveSummary')}
          transition="This is your starting plan, not your final one. The more you tell us about who you are and why you're running, the more we'll tailor every number and every step to you. Let's get to work."
        >
          <p>
            Running for office is one of the hardest and most rewarding things
            you can do, and almost everyone who does it is doing it for the
            first time. You don&apos;t need to be a political expert.
            That&apos;s what we&apos;re here for.
          </p>
          <p>
            Think of us as your campaign manager. We&apos;ll tell you what to
            do, when to do it, and how to reach the voters who decide your race,
            so you&apos;re never guessing what comes next. Thousands of people
            with no experience and no plan have started right where you are and
            gone on to win. You can too.
          </p>
          <p>
            This is your starting plan. We built it from public voter records
            and past elections in your area, and it lays out a real path to
            victory. The more you tell us about yourself and why you&apos;re
            running, the more we&apos;ll shape it around you.
          </p>

          <Subsection title="The Race">
            <TheRaceCopy plan={plan} />
          </Subsection>

          <Subsection title="What It Takes to Win">
            <p>
              Here&apos;s something every winning campaign knows: you have to
              reach a lot more people than the number of votes you need. Most
              people have to hear from you several times before they remember
              your name and decide to vote for you. The research is consistent
              on this, so the plan is built to reach each voter about{' '}
              {plan.contactsPerVoter} times.
            </p>
            <p>Here&apos;s your campaign math, in three numbers.</p>
            <DefinitionList items={plan.campaignMath} />
            <p>
              You won&apos;t do any of this alone, and you won&apos;t do it all
              at once.
            </p>
          </Subsection>

          <Subsection title="Key Dates">
            <p>
              These are the dates that shape your race. You don&apos;t need to
              memorize them, we&apos;ll remind you before each one. The most
              important is getting your first message to voters out before mail
              ballots start going out, because some people vote the day their
              ballot arrives.
            </p>
            <ul className="space-y-2 text-sm">
              {plan.keyDates.map((row) => (
                <li key={`${row.date}-${row.description}`}>
                  <span className="font-semibold text-foreground">
                    {row.date}:
                  </span>{' '}
                  <span className="text-muted-foreground">
                    {row.description}
                  </span>
                </li>
              ))}
            </ul>
          </Subsection>
        </Section>

        {/* 2. Sizing Up Your Race */}
        <Section
          id="plan-section-2"
          number={numberFor('strategicLandscape')}
          title={titleFor('strategicLandscape')}
          transition="Where this comes from: public voter records (L2 Voter Data), your area's certified election results, and our local news directory. See Section 10 for the full list."
        >
          <p className="text-sm text-muted-foreground">
            Before you make a move, it helps to know the shape of your race: who
            you&apos;re up against, what&apos;s working for you, and what
            you&apos;ll have to work around. You don&apos;t need to act on any
            of it today. Knowing it now is what keeps you from wasting time and
            money later. None of this is unusual, and none of it is a
            dealbreaker.
          </p>

          <Subsection title="Who You're Running Against">
            <p>
              This is the first thing to understand, because your message and
              where you spend your time both depend on who else is on the
              ballot.
            </p>
            {isStrategyGenerating ? (
              <OpponentsSkeleton />
            ) : (
              <WhoYoureRunningAgainst plan={plan} />
            )}
          </Subsection>

          <Subsection title="Opportunities Working in Your Favor">
            <PlanTable
              columns={['Opportunities', 'Why it helps you']}
              rows={plan.opportunityRows.map((row) => [
                <span key="t" className="font-semibold text-foreground">
                  {row.title}
                </span>,
                <span key="b" className="text-muted-foreground">
                  {row.body}
                </span>,
              ])}
            />
          </Subsection>

          <Subsection title="Challenges You'll Have to Work Around">
            <PlanTable
              columns={['Challenges', 'How we plan around it']}
              rows={plan.challengeRows.map((row) => [
                <span key="t" className="font-semibold text-foreground">
                  {row.title}
                </span>,
                <span key="b" className="text-muted-foreground">
                  {row.body}
                </span>,
              ])}
            />
          </Subsection>

          <p className="text-sm text-muted-foreground">
            Plenty of first-time candidates have started in exactly this spot
            and won. The point of this page isn&apos;t to worry you, it&apos;s
            to make sure nothing here surprises you later.
          </p>
        </Section>

        {/* 3. Your Key Numbers */}
        <Section
          id="plan-section-3"
          number={numberFor('electoralGoals')}
          title={titleFor('electoralGoals')}
          transition="Where these come from: voter and turnout data is from L2 Voter Data and your area's certified election results. See Section 10 for every source and how firm each estimate is."
        >
          <p className="text-sm text-muted-foreground">
            These are the numbers behind your plan, projected from past voter
            records and our models for{' '}
            <span className="font-semibold text-foreground">
              {districtLabel(plan)}
            </span>
            . The three at the top are the ones to remember. The rest just show
            how we got there.
          </p>
          <PlanTable
            columns={['Number', 'Target', 'How we got it']}
            rows={plan.metrics.map((m) => [
              <span key="m" className="text-foreground">
                {m.metric}
              </span>,
              <span key="t" className="font-semibold text-foreground">
                {m.target}
              </span>,
              <span key="s" className="text-muted-foreground">
                {m.source}
              </span>,
            ])}
          />
          <Subsection
            title={`Why reach each voter ${plan.contactsPerVoter} times?`}
          >
            <p>
              Two reasons. First, not every message gets through: texts bounce,
              calls go unanswered, people are busy. Second, most people need to
              hear from you several times before your name sticks and they
              decide to vote for you. So to earn your{' '}
              <span className="font-semibold text-foreground">
                {plan.winNumber.toLocaleString('en-US')} votes
              </span>
              , the plan reaches out about{' '}
              <span className="font-semibold text-foreground">
                {plan.voterContactGoal.toLocaleString('en-US')} times
              </span>{' '}
              in total, which works out to roughly {plan.contactsPerVoter} tries
              per voter.
            </p>
          </Subsection>
          <Subsection title="Why volunteers, not just hours">
            <p>
              Campaigns run on people, not a big budget. You don&apos;t need to
              think in terms of total hours. Think in terms of friends: about{' '}
              <span className="font-semibold text-foreground">
                {plan.volunteerCount.toLocaleString('en-US')}{' '}
                {plan.volunteerCount === 1 ? 'volunteer' : 'volunteers'}
              </span>{' '}
              giving around{' '}
              <span className="font-semibold text-foreground">
                {plan.volunteerHoursPerWeek} hours a week
              </span>
              , from now to Election Day, covers what this campaign needs. If
              you can call ten people you know and ask each for an afternoon a
              week, you&apos;re most of the way there.
            </p>
          </Subsection>
        </Section>

        {/* 4. What Your Voters Care About */}
        <Section
          id="plan-section-4"
          number={numberFor('voterInsights')}
          title={titleFor('voterInsights')}
          transition="Voter insights sharpen as you fill in your platform and we layer in district-specific survey data. Update your issues in Campaign Manager and this section will re-frame around your priorities."
        >
          <VoterDemographicsStep
            ballotReadyPositionId={voterInsightsContext?.ballotReadyPositionId}
            city={voterInsightsContext?.city}
            state={voterInsightsContext?.state}
            office={voterInsightsContext?.office}
            showLocalNewsSources={false}
            headingsAsSubsections
          />
        </Section>

        {/* 5. What You'll Need: Money and Time */}
        <Section
          id="plan-section-5"
          number={numberFor('resources')}
          title={titleFor('resources')}
          transition="Where this comes from: cost figures are standard vendor rates; filing fees are from BallotReady; channel guidance is sourced above. See Section 10 for detail."
        >
          <p>
            First, the most important thing: GoodParty.org is free, and you can
            run a real campaign without spending much at all. This section
            isn&apos;t a bill. It&apos;s here because almost every candidate
            asks us the same question, &quot;what should I actually spend money
            on?&quot; So here&apos;s the honest answer.
          </p>
          <p>
            A fully-funded version of this race costs about{' '}
            <span className="font-semibold text-foreground">
              ${plan.totalBudget.toLocaleString('en-US')}
            </span>{' '}
            to reach the{' '}
            <span className="font-semibold text-foreground">
              {plan.voterContactGoal.toLocaleString('en-US')} people you need
            </span>{' '}
            and win your{' '}
            <span className="font-semibold text-foreground">
              {plan.winNumber.toLocaleString('en-US')} votes
            </span>
            . You won&apos;t need all of it, and most of it is optional.
            Here&apos;s where that money would go, and when each piece is worth
            it.
          </p>
          <Subsection title="Where Your Money Would Go">
            <PlanTable
              columns={[
                'Way to reach voters',
                "When it's worth it",
                'Cost each',
                'Your estimated total',
              ]}
              rows={plan.budgetLineItems.map((b) => [
                <span key="c" className="text-foreground">
                  {b.category}
                </span>,
                <span key="w" className="text-muted-foreground">
                  {b.whenWorthIt}
                </span>,
                <span key="e" className="whitespace-nowrap text-foreground">
                  {b.costEach}
                </span>,
                <span key="a" className="font-semibold text-foreground">
                  {b.amount}
                </span>,
              ])}
            />
            <p>A few honest notes so you can choose well:</p>
            <DefinitionList
              items={[
                {
                  title: 'Texting beats email for reaching voters.',
                  body: 'Save email for asking your supporters to donate, where it works better.',
                },
                {
                  title: 'Heads up on mailers:',
                  body: "GoodParty.org doesn't send mail for you yet, so that's one you'd arrange on your own. We include it because you'll hear about it from others, and it helps to know where it fits.",
                },
                {
                  title: 'What the research shows:',
                  body: 'researchers who study local and independent races consistently find that personal contact, texts, calls, and doors, moves voters more than paid ads at this level. When something\'s based on our own experience instead of a study, we\'ll say "based on what we see across campaigns."',
                },
              ]}
            />
          </Subsection>
          <Subsection title="How to Raise This">
            <p>
              <span className="font-semibold text-foreground">
                ${plan.totalBudget.toLocaleString('en-US')}
              </span>{' '}
              sounds like real money, but for most candidates at this level it
              comes from a surprisingly small number of people, usually 20 to 40
              folks giving $25 to $100 each. You don&apos;t need a big check
              from anyone. The mix below is just a starting point, and each
              source tends to feed the next: an online donor becomes a
              house-party host, a loan you make yourself gets paid back by small
              donations you didn&apos;t expect.
            </p>
            <PlanTable
              columns={['Where it comes from', 'Share']}
              rows={plan.fundraisingMix.map((f) => [
                <span key="s" className="text-foreground">
                  {f.source}
                </span>,
                <span key="sh" className="font-semibold text-foreground">
                  {f.share}
                </span>,
              ])}
            />
          </Subsection>
          <Subsection title="How Much Time It Takes">
            <p>
              Campaigns run on hours, but you don&apos;t need to count them. A
              race your size runs smoothly with about{' '}
              <span className="font-semibold text-foreground">
                {plan.volunteerCount.toLocaleString('en-US')}{' '}
                {plan.volunteerCount === 1 ? 'volunteer' : 'volunteers'} giving
                around {plan.volunteerHoursPerWeek} hours a week
              </span>{' '}
              from now to Election Day, plus roughly{' '}
              <span className="font-semibold text-foreground">
                {plan.candidateHoursPerWeek} hours a week from you
              </span>
              . That&apos;s it. No paid staff, no full-time hours. If you can
              ask ten people you trust for an afternoon a week, you&apos;ve got
              what you need.
            </p>
          </Subsection>
        </Section>

        {/* 6. Your Campaign Timeline */}
        <Section
          id="plan-section-6"
          number={numberFor('timeline')}
          title={titleFor('timeline')}
          transition="Tell us about your launch plans and your schedule in Campaign Manager, and we'll fill this timeline in with your own events and deadlines."
        >
          <p className="text-sm text-muted-foreground">
            Here&apos;s the whole race on one timeline, in three stages: get on
            the ballot, get known, and get out the vote. You don&apos;t have to
            track these yourself, we&apos;ll remind you before each one. The
            dates that can&apos;t move are marked along the way.
          </p>
          <div className="space-y-8">
            {plan.timelineStages.map((stage, index) => (
              <TimelineStageBlock
                key={stage.stage}
                stage={stage}
                index={index}
              />
            ))}
          </div>
        </Section>

        {/* 7. Community Events and Local Press */}
        <Section
          id="plan-section-7"
          number={numberFor('community')}
          title={titleFor('community')}
          transition="Once you tell us why you're running and what you stand for, we can turn this into ready-to-use talking points and a press email you can send this week."
        >
          <p className="text-sm text-muted-foreground">
            Earned media and showing up in person are the most valuable ways to
            get known in a race this size. One mention in a local outlet, or a
            strong showing at a neighborhood event, can reach more voters than
            any ad you could buy on this budget.
          </p>
          <Subsection title="Events Worth Showing Up To">
            {isEventsGenerating ? (
              <CommunityEventsSkeleton />
            ) : isEventsError || plan.civicEvents.length === 0 ? (
              // Empty state — either the LLM returned zero qualifying
              // events or the endpoint errored. Either way no table to
              // show; the user shouldn't see stale templated rows.
              <p className="text-sm text-muted-foreground italic">
                No community events found yet. We&apos;ll update this section as
                we find them.
              </p>
            ) : (
              <>
                <PlanTable
                  columns={['Event', 'When and where', "Why it's worth going"]}
                  rows={plan.civicEvents.map((e) => [
                    <span key="e" className="text-foreground">
                      {e.event}
                    </span>,
                    <span key="w" className="text-muted-foreground">
                      <span className="text-foreground">{e.date}</span>
                      {e.address ? (
                        <>
                          <br />
                          {e.address}
                        </>
                      ) : null}
                    </span>,
                    <BulletList key="b" items={e.whyBullets} />,
                  ])}
                />
                <p>
                  We can help you prep a simple one-page handout and a short way
                  to introduce yourself, so you make the most of each one.
                </p>
              </>
            )}
          </Subsection>
          <Subsection title="Local Press to Reach Out To">
            <p>
              Aim for at least one piece of local coverage a week from now
              through Election Day. Here are the outlets that cover races like
              yours, and what to pitch each one.
            </p>
            {isPressOutletsGenerating ? (
              <PressOutletsSkeleton />
            ) : isPressOutletsError || plan.pressOutlets.length === 0 ? (
              // Empty state — either the LLM returned zero qualifying
              // outlets or the endpoint errored. Either way no table to
              // show; the user shouldn't see stale templated rows.
              <p className="text-sm text-muted-foreground italic">
                No local press &amp; media outlets found yet. We&apos;ll update
                this section as we find them.
              </p>
            ) : (
              <PlanTable
                columns={['Outlet', 'Type', 'What to pitch', 'Contact']}
                rows={plan.pressOutlets.map((o) => [
                  <span key="o" className="text-foreground">
                    {o.outlet}
                  </span>,
                  <span key="t" className="text-muted-foreground">
                    {o.type}
                  </span>,
                  <span key="a" className="text-muted-foreground">
                    {o.angle}
                  </span>,
                  <span
                    key="c"
                    className="whitespace-pre-line text-muted-foreground"
                  >
                    {o.contact}
                  </span>,
                ])}
              />
            )}
          </Subsection>
        </Section>

        {/* 8. Your Voter Contact Plan */}
        <Section
          id="plan-section-8"
          number={numberFor('voterContact')}
          title={titleFor('voterContact')}
          transition="Repeating contact only works if the message is specific and real. Once you share your story and your issues, we'll help you write each one, so all you have to do is hit send."
        >
          <p className="text-sm text-muted-foreground">
            This is the schedule for when you&apos;ll reach out to voters, and
            why. Every message has one job: first to introduce you, then to make
            your case, and finally to get people to actually vote. Texts do most
            of the work because they&apos;re cheap and reach the most people.
            Robocalls go to the voters who only have a landline.
          </p>
          <p className="text-sm text-muted-foreground">
            {plan.cellphoneCount !== null && plan.landlineCount !== null ? (
              <>
                Here&apos;s how it ties back to your numbers: each text goes to
                your roughly{' '}
                <span className="font-semibold text-foreground">
                  {plan.cellphoneCount.toLocaleString('en-US')}
                </span>{' '}
                voters with a cellphone, and each robocall to your roughly{' '}
                <span className="font-semibold text-foreground">
                  {plan.landlineCount.toLocaleString('en-US')}
                </span>{' '}
                voters with a landline. Run all 7 and you&apos;ll have made
                about{' '}
                <span className="font-semibold text-foreground">
                  {plan.voterContactGoal.toLocaleString('en-US')} contacts
                </span>
                , the number of people you need to reach.
              </>
            ) : (
              <>
                Run all 7 and you&apos;ll have made about{' '}
                <span className="font-semibold text-foreground">
                  {plan.voterContactGoal.toLocaleString('en-US')} contacts
                </span>
                , the number of people you need to reach.
              </>
            )}
          </p>
          <PlanTable
            columns={['When', 'What you send', 'Its job']}
            rows={plan.contactSchedule.map((s) => [
              <span key="d" className="whitespace-nowrap font-semibold">
                {s.date}
              </span>,
              <span key="t" className="font-semibold text-foreground">
                {s.tactic}
              </span>,
              <span key="p" className="text-muted-foreground">
                {s.purpose}
              </span>,
            ])}
          />
        </Section>

        {/* 9. Tracking Your Progress */}
        <Section
          id="plan-section-9"
          number={numberFor('measurement')}
          title={titleFor('measurement')}
          transition="The measurement system is live in Campaign Manager. What it's measuring right now is a default campaign. Once you personalize your plan with your goals, your capacity, and your timeline, the dashboard starts tracking the campaign you're actually running, and the gap between where you are and where you need to be becomes a lot easier to read."
        >
          <p className="text-sm text-foreground">
            Every week, log into your Campaign Manager to check your progress.
            We estimate the number of likely votes you are on track to receive
            based on the activity you complete. Our proprietary models predict
            the number of likely votes you get, based on the{' '}
            <span className="font-semibold">quality</span> and{' '}
            <span className="font-semibold">frequency</span> of{' '}
            <span className="font-semibold">voter contacts</span>.
          </p>
          <p className="text-sm text-foreground">
            This number will grow as you work through your voter contact plan.
            It will never reach 100% — that is by design. No campaign plan can
            guarantee an outcome, and there is always another action that you
            can take to increase your chances of winning. What this will do is
            show you clearly whether you are on pace, ahead, or behind, and give
            you time to adjust before it is too late.
          </p>
          <Subsection title="How to read your progress">
            <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
              <li>
                If your likely votes are tracking toward your projected votes
                needed to win, stay the course.
              </li>
              <li>
                If you are falling behind, prioritize scheduling your next text
                or robocall campaign and look for additional outreach
                opportunities.
              </li>
              <li>
                Check in at least once a week — small gaps caught early are easy
                to close; the same gap caught in the final week is not.
              </li>
            </ul>
          </Subsection>
        </Section>

        {/* 10. Methodology and Data Sources */}
        <Section
          id="plan-section-10"
          number={numberFor('methodology')}
          title={titleFor('methodology')}
          transition="This plan was prepared by GoodParty.org's automated campaign-intelligence system and is intended as a working starting point for the campaign. All estimates should be revisited weekly as new data arrives."
        >
          <p className="text-sm text-muted-foreground">
            This plan was produced by GoodParty.org using public voter data,
            historical election results, and our proprietary models. Every
            metric in this document is an estimate derived from the sources
            below. Where applicable, we include our best-estimate confidence
            interval so that the candidate and campaign manager can understand
            how firm each number is.
          </p>
          <Subsection title="Data Sources">
            <PlanTable
              columns={['Metric', 'Source', 'Last Updated']}
              rows={plan.dataSources.map((d) => [
                <span key="m" className="text-foreground">
                  {d.metric}
                </span>,
                <span key="s" className="text-muted-foreground">
                  {d.source}
                </span>,
                <span
                  key="u"
                  className="whitespace-nowrap text-muted-foreground"
                >
                  {d.lastUpdated}
                </span>,
              ])}
            />
          </Subsection>
          <Subsection title="Key Assumptions">
            <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
              {plan.keyAssumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </Subsection>
          <Subsection title="Confidence & Standard Error">
            <PlanTable
              columns={[
                'Estimate',
                'Point Value',
                'Est. Range (95% CI)',
                'Notes',
              ]}
              rows={plan.confidenceEstimates.map((c) => [
                <span key="e" className="text-foreground">
                  {c.estimate}
                </span>,
                <span key="p" className="font-semibold whitespace-nowrap">
                  {c.pointValue}
                </span>,
                <span
                  key="r"
                  className="text-muted-foreground whitespace-nowrap"
                >
                  {c.range}
                </span>,
                <span key="n" className="text-muted-foreground">
                  {c.notes}
                </span>,
              ])}
            />
            <p className="text-sm text-muted-foreground">
              Standard-error ranges above reflect modeling uncertainty only.
              They do not account for late-breaking external events (weather,
              news cycles, last-minute challengers). The campaign should treat
              the point values as planning numbers and revisit them weekly as
              turnout signals harden.
            </p>
          </Subsection>
          <Subsection title="What This Plan Does Not Do">
            <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
              {plan.planDoesNotDo.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Subsection>
        </Section>

        {/* 11. Glossary */}
        <Section
          id="plan-section-11"
          number={numberFor('glossary')}
          title={titleFor('glossary')}
        >
          <PlanTable
            columns={['Term', 'Definition']}
            rows={plan.glossary.map((g) => [
              <span key="t" className="font-semibold text-foreground">
                {g.term}
              </span>,
              <span key="d" className="text-muted-foreground">
                {g.definition}
              </span>,
            ])}
          />
        </Section>
      </div>
    </div>
  )
}

export default PlanSections
