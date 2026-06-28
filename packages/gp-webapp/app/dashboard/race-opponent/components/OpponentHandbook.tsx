'use client'

import { Card } from '@styleguide'
import { ExternalLinkIcon } from '@styleguide/components/ui/icons'
import type { SelfResearchFinding } from 'gpApi/api-endpoints'

type Props = {
  opponentName: string
  findings: SelfResearchFinding[]
}

// Sourced-or-silent in the UI: a finding only renders when it carries a working
// source link. The contract types every finding's sourceUrl as a non-empty
// string, but this is the candidate-facing trust surface, so we re-check the
// runtime value and drop anything without a usable link rather than rendering an
// unsourced claim the candidate can't verify.
const hasSourceLink = (finding: SelfResearchFinding): boolean =>
  typeof finding.sourceUrl === 'string' && finding.sourceUrl.trim().length > 0

const FindingCard = ({
  finding,
}: {
  finding: SelfResearchFinding
}): React.JSX.Element => (
  <Card className="flex flex-col gap-3 p-5">
    <p className="text-base font-medium text-foreground">{finding.claim}</p>

    <div className="flex flex-col gap-1 rounded-md bg-muted p-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Source
      </span>
      <p className="text-sm text-foreground">{finding.sourceExtract}</p>
      <a
        href={finding.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-info hover:underline"
      >
        <span className="break-all">
          {finding.sourceTitle ?? finding.sourceUrl}
        </span>
        <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
      </a>
    </div>
  </Card>
)

// Stable category grouping: preserve first-seen order of categories so the
// Handbook layout doesn't reshuffle between reads of the same data.
const groupByCategory = (
  findings: SelfResearchFinding[],
): Array<{ category: string; findings: SelfResearchFinding[] }> => {
  const groups: Array<{ category: string; findings: SelfResearchFinding[] }> =
    []
  for (const finding of findings) {
    const existing = groups.find((g) => g.category === finding.category)
    if (existing) {
      existing.findings.push(finding)
    } else {
      groups.push({ category: finding.category, findings: [finding] })
    }
  }
  return groups
}

const OpponentHandbook = ({
  opponentName,
  findings,
}: Props): React.JSX.Element => {
  const sourced = findings.filter(hasSourceLink)

  if (sourced.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-foreground">
          {opponentName}
        </h2>
        <p className="text-sm text-muted-foreground">
          No sourced findings yet. As we verify public information about{' '}
          {opponentName}, it will appear here — each with the source we found it
          in.
        </p>
      </div>
    )
  }

  const groups = groupByCategory(sourced)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-lg font-semibold text-foreground">
          {opponentName}
        </h2>
        <p className="text-sm text-muted-foreground">
          Sourced findings on your opponent, grouped by topic. Every finding
          links to the source we found it in.
        </p>
      </header>

      {groups.map((group) => (
        <section key={group.category} className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.category}
          </h3>
          <div className="flex flex-col gap-3">
            {group.findings.map((finding) => (
              <FindingCard key={finding.id} finding={finding} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export default OpponentHandbook
