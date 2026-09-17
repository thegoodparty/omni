'use client'

import { useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@styleguide'
import { ChevronDownIcon } from '@styleguide/components/ui/icons'
import type {
  AffectedResident,
  AffectedResidentsList,
} from 'gpApi/api-endpoints'
import AffectedResidentsMap from './AffectedResidentsMap'

const PAGE_SIZE = 100

type Props = {
  list: AffectedResidentsList
}

// A null factor score is a dropped factor, not a low one. Rendering it as a
// dash keeps it visibly different from a real 0.00, which is a score.
const factor = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : value.toFixed(2)

const age = (value: AffectedResident['age']) => {
  if (!value) return null
  return value.basis === 'year-only'
    ? `${value.years} (±1)`
    : String(value.years)
}

const AffectedResidentsView = ({ list }: Props): React.JSX.Element => {
  const [shown, setShown] = useState(PAGE_SIZE)
  const { issue, residents } = list
  const visible = residents.slice(0, shown)

  // Per-factor missing counts, computed from the list rather than stated, so
  // this line cannot drift from the data the way a hardcoded sentence would.
  const missingByFactor = useMemo(
    () =>
      issue.factors
        .map((f) => ({
          label: f.label,
          missing: residents.filter((r) => r.factorScores[f.key] === null)
            .length,
        }))
        .filter((f) => f.missing > 0),
    [issue.factors, residents],
  )

  const rankingDiffers = residents.some(
    (r) => Math.abs(r.affectednessScore - r.rankingScore) > 0.0005,
  )

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold text-foreground">
          Residents affected by {issue.title}
        </h1>
        <p className="text-sm text-muted-foreground">{issue.summary}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge variant="soft">{residents.length} residents</Badge>
          <Badge variant="soft">{issue.jurisdiction}</Badge>
          <Badge variant="soft">Run {issue.runDate}</Badge>
        </div>
      </header>

      <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">
          Why these residents
        </h2>
        <p className="text-sm text-muted-foreground">
          {issue.affectednessRead}
        </p>
      </section>

      <AffectedResidentsMap residents={residents} />

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">
          How this list was built
        </h2>
        <p className="text-sm text-muted-foreground">{issue.scoringRule}</p>
        <dl className="flex flex-col gap-2 text-sm">
          {issue.factors.map((f) => (
            <div key={f.key} className="flex flex-col gap-0.5">
              <dt className="font-medium text-foreground">
                {f.label} (weight {f.weight})
              </dt>
              <dd className="text-muted-foreground">{f.rule}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-1 border-t border-border pt-3 text-sm text-muted-foreground">
          {issue.gates.map((gate) => (
            <p key={gate.label}>
              <span className="font-medium text-foreground">
                {gate.label}:{' '}
              </span>
              {gate.detail}
            </p>
          ))}
          <p>
            <span className="font-medium text-foreground">Use: </span>
            {issue.useCase}
          </p>
          {rankingDiffers ? (
            <p>
              <span className="font-medium text-foreground">Ordering: </span>
              {issue.rankingNote}
            </p>
          ) : null}
        </div>
      </section>

      {/* The runbook's rule is that a score never ships without the caveats
          that qualify it, so this panel is not optional — only collapsed. */}
      <Collapsible className="rounded-lg border border-warning bg-warning-background">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 p-4 text-left">
          <span className="text-sm font-semibold text-foreground">
            Read before you call: {issue.caveats.length} limits of this list
          </span>
          <ChevronDownIcon className="size-4 shrink-0" aria-hidden />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="flex list-disc flex-col gap-2 px-8 pb-4 text-sm text-muted-foreground">
            {issue.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-foreground">
            The list, ranked
          </h2>
          <p className="text-xs text-muted-foreground">
            A dash in a factor column means that input was missing, so the
            factor dropped out of the score rather than counting as zero.
            {missingByFactor.length > 0
              ? ` ${missingByFactor
                  .map(
                    (f) =>
                      `${f.missing} of ${residents.length} have no ${f.label.toLowerCase()}`,
                  )
                  .join('; ')}.`
              : ''}
          </p>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Age</TableHead>
                {issue.factors.map((f) => (
                  <TableHead key={f.key} className="text-right">
                    {f.label}
                  </TableHead>
                ))}
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="text-right">Confidence</TableHead>
                <TableHead>Why</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((resident) => (
                <TableRow key={`${resident.rank}-${resident.phone}`}>
                  <TableCell className="text-muted-foreground">
                    {resident.rank}
                  </TableCell>
                  <TableCell className="font-medium">{resident.name}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {resident.address}
                    <span className="block text-xs text-muted-foreground">
                      {resident.city} {resident.zip}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <a
                      href={`tel:${resident.phone.replace(/[^0-9]/g, '')}`}
                      className="font-medium text-info-600"
                    >
                      {resident.phone}
                    </a>
                    <span className="block text-xs text-muted-foreground">
                      {resident.phoneType}
                    </span>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {age(resident.age) ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  {issue.factors.map((f) => (
                    <TableCell key={f.key} className="text-right tabular-nums">
                      {factor(resident.factorScores[f.key])}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-semibold tabular-nums">
                    {resident.affectednessScore.toFixed(3)}
                  </TableCell>
                  <TableCell
                    className="text-right tabular-nums"
                    title={resident.confidence?.note ?? undefined}
                  >
                    {resident.confidence
                      ? resident.confidence.score.toFixed(2)
                      : '—'}
                  </TableCell>
                  <TableCell className="min-w-[260px] text-xs text-muted-foreground">
                    {resident.why}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {shown < residents.length ? (
          <Button
            variant="outline"
            className="self-center"
            onClick={() => setShown((n) => n + PAGE_SIZE)}
          >
            Show {Math.min(PAGE_SIZE, residents.length - shown)} more ({shown}{' '}
            of {residents.length})
          </Button>
        ) : null}
      </section>
    </div>
  )
}

export default AffectedResidentsView
