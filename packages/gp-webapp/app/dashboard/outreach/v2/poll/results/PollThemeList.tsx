import type { Theme } from '@goodparty_org/contracts'
import { Button, ChevronRightIcon, ContentCard } from '@styleguide'
import { SERVE_POLL_RESULTS_COPY } from './pollResultsCopy'

export const PollThemeList = ({
  themes,
  nonClusteredCount,
  onOpenTheme,
  onOpenNonClustered,
}: {
  themes: Theme[]
  nonClusteredCount: number
  onOpenTheme: (theme: Theme) => void
  onOpenNonClustered: () => void
}) => (
  <section className="flex flex-col gap-3">
    <h2 className="text-lg font-semibold text-foreground">
      {SERVE_POLL_RESULTS_COPY.themesTitle}
    </h2>
    {themes.map((theme, index) => (
      <ContentCard
        key={theme.id}
        overline={`#${index + 1}`}
        title={theme.label}
        description={theme.summary}
        helper={
          <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {SERVE_POLL_RESULTS_COPY.mentions(theme.mentionCount)}
            {theme.newMentions > 0 && (
              <span className="rounded-full bg-primary-light px-2 py-0.5 text-xs font-medium text-primary">
                {SERVE_POLL_RESULTS_COPY.newChip(theme.newMentions)}
              </span>
            )}
          </span>
        }
      >
        <div className="flex justify-end">
          <Button type="button" onClick={() => onOpenTheme(theme)}>
            {SERVE_POLL_RESULTS_COPY.viewResponses}
            <ChevronRightIcon />
          </Button>
        </div>
      </ContentCard>
    ))}
    {nonClusteredCount > 0 && (
      <ContentCard
        title={SERVE_POLL_RESULTS_COPY.nonClustered.title}
        description={SERVE_POLL_RESULTS_COPY.nonClustered.body}
        helper={
          <span className="text-sm font-semibold">
            {SERVE_POLL_RESULTS_COPY.nonClustered.count(nonClusteredCount)}
          </span>
        }
      >
        <div className="flex justify-end">
          <Button type="button" onClick={onOpenNonClustered}>
            {SERVE_POLL_RESULTS_COPY.viewResponses}
            <ChevronRightIcon />
          </Button>
        </div>
      </ContentCard>
    )}
  </section>
)
