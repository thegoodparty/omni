'use client'

import type { Item, Source } from '@shared/briefings/types'
import {
  briefingItemCardPath,
  briefingItemTitlePath,
} from '@shared/briefings/routes'
import { selectElementContents } from '@shared/briefings/anchorResolver'
import { SectionSourcePills } from '@shared/citations'
import { useAnnotationsCtx } from '../annotations/AnnotationsScope'
import RecentNewsList from './RecentNewsList'
import TalkingPointsList from './TalkingPointsList'
import SourcesCollapsible from './SourcesCollapsible'
import FeedbackRow from './FeedbackRow'
import CardLevelNotesList from './CardLevelNotesList'

type Variant = 'full' | 'whatToExpectOnly'

type Props = {
  item: Item
  itemIndex: number
  sources: Source[]
  domId: string
  meetingDate: string
  showFeedback: boolean
  variant?: Variant
}

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[12px] font-bold uppercase tracking-wide text-foreground">
    {children}
  </span>
)

const formatSentimentLine = (meanScore: number): string => {
  const support = Math.round(meanScore)
  const oppose = 100 - support
  return `${support}% support · ${oppose}% oppose`
}

/**
 * One item card on the briefing detail page. Sections rendered, in order:
 * Summary, Budget Impact, Constituent Sentiment, Recent News, Talking Points,
 * Sources collapsible, feedback row.
 *
 * Every string rendered as body text carries a `data-anchor-json-path`
 * attribute so phase 4's selection toolbar can build an anchor that maps to
 * the v2 artifact shape.
 */
const AgendaItemCard = ({
  item,
  itemIndex,
  sources,
  domId,
  meetingDate,
  showFeedback,
  variant = 'full',
}: Props): React.JSX.Element => {
  const base = briefingItemCardPath(itemIndex)
  const titlePath = briefingItemTitlePath(itemIndex)
  const { activeCard, setActiveCard, annotations, openChatsSurface } =
    useAnnotationsCtx()
  const isActive = activeCard?.key === domId
  // If the assistant already has a thread anchored to this item's title,
  // clicking the title opens that thread directly rather than re-surfacing
  // the selection toolbar.
  const titleChat = annotations.find(
    (a) => a.kind === 'chat' && a.jsonPath === titlePath,
  )
  const activate = () =>
    setActiveCard({
      key: domId,
      jsonPath: base,
      titleJsonPath: titlePath,
      title: item.title,
    })
  const display = item.display
  const sentiment = display.constituent_sentiment
  const budget = display.budget_impact
  const news = display.recent_news ?? []
  const talkingPoints = display.talking_points ?? []

  const sourceById = new Map(sources.map((s) => [s.id, s]))

  const aggregatedSourceIds = [
    ...(sentiment?.source_ids ?? []),
    ...(budget?.source_ids ?? []),
  ]
  const uniqueIds = Array.from(new Set(aggregatedSourceIds))
  const itemSources = uniqueIds
    .map((id) => sourceById.get(id))
    .filter((s): s is Source => Boolean(s))

  const isWhatToExpectOnly = variant === 'whatToExpectOnly'

  return (
    <article
      id={domId}
      onClick={activate}
      // Make the card root addressable in the cycler's DOM-order index.
      // Card-level notes use this exact path as their jsonPath; without
      // an element carrying it, `enrichForCycler` couldn't place them in
      // document order and dropped them to the end of the list.
      data-anchor-json-path={base}
      aria-current={isActive ? 'true' : undefined}
      className={`flex scroll-mt-[104px] cursor-pointer flex-col gap-4 rounded-2xl border bg-card p-6 transition-colors lg:scroll-mt-3 ${
        isActive
          ? 'border-info-600 ring-2 ring-info-600/40'
          : 'border-border hover:border-foreground/20'
      }`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          {/* With no chat yet, clicking the title selects its full text so
              the HighlightToolbar surfaces anchored to the title — the same
              anchor openCardLevelChat uses — without the user having to
              drag-highlight it by hand. With a chat already attached, it
              opens that thread directly. */}
          <h3
            className="w-fit cursor-pointer text-lg font-semibold text-foreground"
            data-anchor-json-path={titlePath}
            onClick={(e) => {
              if (titleChat) {
                e.stopPropagation()
                openChatsSurface(titleChat.id)
              } else {
                selectElementContents(e.currentTarget)
              }
            }}
          >
            {item.title}
          </h3>
        </div>
      </header>

      <section className="flex flex-col gap-2">
        <SectionLabel>What to expect</SectionLabel>
        <p
          className="text-sm leading-6 text-foreground"
          data-anchor-json-path={`${base}/display/summary`}
        >
          {display.summary}
        </p>
      </section>

      {isWhatToExpectOnly ? null : (
        <>
          {budget ? (
            <section className="flex flex-col gap-2">
              <SectionLabel>Budget impact</SectionLabel>
              <p
                className="text-sm leading-6 text-foreground"
                data-anchor-json-path={`${base}/display/budget_impact/summary`}
              >
                {budget.summary}
              </p>
              {budget.source_ids.length > 0 ? (
                <SectionSourcePills
                  sourceIds={budget.source_ids}
                  sourceById={sourceById}
                />
              ) : null}
            </section>
          ) : null}

          {sentiment ? (
            <section className="flex flex-col gap-2">
              <SectionLabel>Constituent sentiment</SectionLabel>
              {sentiment.haystaq_status === 'ok' &&
              typeof sentiment.mean_score === 'number' ? (
                <p className="text-sm font-semibold text-foreground">
                  {formatSentimentLine(sentiment.mean_score)}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No sentiment data yet for {item.title}.
                </p>
              )}
              <p
                className="text-sm leading-6 text-foreground"
                data-anchor-json-path={`${base}/display/constituent_sentiment/summary`}
              >
                {sentiment.summary}
              </p>
              {sentiment.detail ? (
                <p
                  className="text-sm leading-6 text-foreground"
                  data-anchor-json-path={`${base}/display/constituent_sentiment/detail`}
                >
                  {sentiment.detail}
                </p>
              ) : null}
              {sentiment.source_ids.length > 0 ? (
                <SectionSourcePills
                  sourceIds={sentiment.source_ids}
                  sourceById={sourceById}
                />
              ) : null}
            </section>
          ) : null}

          {news.length > 0 ? (
            <section className="flex flex-col gap-2">
              <SectionLabel>Recent news</SectionLabel>
              <RecentNewsList
                items={news}
                pathPrefix={`${base}/display/recent_news`}
              />
            </section>
          ) : null}

          {talkingPoints.length > 0 ? (
            <section className="flex flex-col gap-2">
              <SectionLabel>Talking points</SectionLabel>
              <TalkingPointsList
                points={talkingPoints}
                pathPrefix={`${base}/display/talking_points`}
              />
            </section>
          ) : null}
        </>
      )}

      <CardLevelNotesList cardPath={base} />

      {isWhatToExpectOnly ? null : (
        <>
          {itemSources.length > 0 ? (
            <div className="border-y border-border py-2">
              <SourcesCollapsible sources={itemSources} />
            </div>
          ) : null}
          {showFeedback ? (
            <FeedbackRow meetingDate={meetingDate} itemId={item.id} />
          ) : null}
        </>
      )}
    </article>
  )
}

export default AgendaItemCard
