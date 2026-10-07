'use client'

import { Card, ExternalLinkIcon, ShieldIcon } from '@styleguide'
import type { SelfResearchFinding } from 'gpApi/api-endpoints'

type Props = {
  findings: SelfResearchFinding[]
}

// Sourced-or-silent in the UI: a finding only renders when it carries a working
// source link. The contract types every finding's sourceUrl as a non-empty
// string, but this is the candidate-facing trust surface, so we re-check the
// runtime value and drop anything without a usable link rather than rendering an
// unsourced vulnerability the candidate can't verify.
const hasSourceLink = (finding: SelfResearchFinding): boolean =>
  typeof finding.sourceUrl === 'string' && finding.sourceUrl.trim().length > 0

const FindingCard = ({
  finding,
}: {
  finding: SelfResearchFinding
}): React.JSX.Element => (
  <Card className="flex flex-col gap-3 p-5">
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {finding.category}
      </span>
      <p className="text-base font-medium text-foreground">{finding.claim}</p>
    </div>

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

    {finding.draftedResponse && (
      <div className="flex flex-col gap-1 rounded-md border border-primary bg-primary/5 p-3">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
          <ShieldIcon className="size-3.5" aria-hidden />
          Drafted response
        </span>
        <p className="whitespace-pre-wrap text-sm text-foreground">
          {finding.draftedResponse}
        </p>
      </div>
    )}
  </Card>
)

const SelfResearchReport = ({ findings }: Props): React.JSX.Element => {
  const sourced = findings.filter(hasSourceLink)

  if (sourced.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No sourced vulnerabilities were found. That&apos;s good news — there was
        nothing in your public footprint we could verify against a source.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        These are the vulnerabilities we found in your own public footprint,
        each with the source we found it in and a drafted response you can use.
      </p>
      <div className="flex flex-col gap-4">
        {sourced.map((finding) => (
          <FindingCard key={finding.id} finding={finding} />
        ))}
      </div>
    </div>
  )
}

export default SelfResearchReport
