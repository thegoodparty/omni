'use client'

import { useState } from 'react'
import { Button, Card, Input, Label } from '@styleguide'
import { InfoIcon, PlusIcon, Trash2Icon } from '@styleguide/components/ui/icons'

// Mirrors the gp-api ManualOpponentsRequestSchema: a URL hint is optional, but
// when present it must be a well-formed https URL, so a bad value never reaches
// the backend (which 400s) or the collection agent as a discovery start point.
const isValidHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export type ManualOpponentInput = {
  name: string
  ballotpediaUrl?: string
  website?: string
}

type OpponentRow = {
  name: string
  ballotpediaUrl: string
  website: string
}

type RowErrors = {
  ballotpediaUrl?: string
  website?: string
}

// Server caps the list at 10 (ManualOpponentsRequestSchema .max(10)); match it
// client-side so "Add another opponent" can't build a payload the backend 400s.
const MAX_OPPONENTS = 10

const EMPTY_ROW: OpponentRow = { name: '', ballotpediaUrl: '', website: '' }

const URL_ERROR_MESSAGE = 'Enter a valid https URL (https://…).'

type Props = {
  submitting: boolean
  onSubmit: (opponents: ManualOpponentInput[]) => void
}

const AddOpponentsForm = ({
  submitting,
  onSubmit,
}: Props): React.JSX.Element => {
  const [rows, setRows] = useState<OpponentRow[]>([{ ...EMPTY_ROW }])
  const [errors, setErrors] = useState<RowErrors[]>([{}])

  const updateRow = (
    index: number,
    field: keyof OpponentRow,
    value: string,
  ): void => {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    )
  }

  const addRow = (): void => {
    setRows((prev) => [...prev, { ...EMPTY_ROW }])
    setErrors((prev) => [...prev, {}])
  }

  const removeRow = (index: number): void => {
    setRows((prev) => prev.filter((_, i) => i !== index))
    setErrors((prev) => prev.filter((_, i) => i !== index))
  }

  // The last row must be named before another blank one can be appended; this
  // also gates "Run the analysis" via hasNamedRow below.
  const lastRow = rows[rows.length - 1]
  const canAddRow = rows.length < MAX_OPPONENTS && Boolean(lastRow?.name.trim())
  const hasNamedRow = rows.some((row) => row.name.trim())

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    const namedRows = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.name.trim())

    const nextErrors: RowErrors[] = rows.map(() => ({}))
    let hasError = false
    for (const { row, index } of namedRows) {
      const ballotpedia = row.ballotpediaUrl.trim()
      const website = row.website.trim()
      if (ballotpedia && !isValidHttpsUrl(ballotpedia)) {
        nextErrors[index] = {
          ...nextErrors[index],
          ballotpediaUrl: URL_ERROR_MESSAGE,
        }
        hasError = true
      }
      if (website && !isValidHttpsUrl(website)) {
        nextErrors[index] = { ...nextErrors[index], website: URL_ERROR_MESSAGE }
        hasError = true
      }
    }

    setErrors(nextErrors)
    if (hasError || namedRows.length === 0) {
      return
    }

    onSubmit(
      namedRows.map(({ row }) => ({
        name: row.name.trim(),
        ballotpediaUrl: row.ballotpediaUrl.trim() || undefined,
        website: row.website.trim() || undefined,
      })),
    )
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <div className="flex w-full min-w-0 items-start gap-3 rounded-lg border border-info-600/20 bg-info-50 p-4">
        <InfoIcon
          className="mt-0.5 size-5 shrink-0 text-info-600"
          aria-hidden
        />
        <div className="flex w-full min-w-0 flex-col gap-1">
          <h2 className="text-sm font-semibold text-foreground">
            No opponents found
          </h2>
          <p className="w-full min-w-0 break-words text-sm text-muted-foreground">
            We didn&apos;t find any opponents for your race. If you have
            information about them, fill out the form below and we&apos;ll run
            the analysis based on the information you provide.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold text-foreground">
          Add the opponents you want to analyze
        </h3>
        <p className="text-sm text-muted-foreground">
          Drop in each candidate running against you. Add a Ballotpedia page or
          website for every additional opponent.
        </p>
      </div>

      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {rows.map((row, index) => {
          const rowErrors = errors[index] ?? {}
          return (
            <Card key={index} className="flex flex-col gap-4 p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">
                  Opponent {index + 1}
                </span>
                {rows.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="small"
                    onClick={() => removeRow(index)}
                    className="flex items-center gap-1.5 text-muted-foreground"
                  >
                    <Trash2Icon className="size-4" aria-hidden />
                    Remove
                  </Button>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor={`opponent-name-${index}`}>Name</Label>
                <Input
                  id={`opponent-name-${index}`}
                  value={row.name}
                  onChange={(e) => updateRow(index, 'name', e.target.value)}
                  placeholder="Jane Doe"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor={`opponent-ballotpedia-${index}`}>
                  Ballotpedia page{' '}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Input
                  id={`opponent-ballotpedia-${index}`}
                  value={row.ballotpediaUrl}
                  onChange={(e) =>
                    updateRow(index, 'ballotpediaUrl', e.target.value)
                  }
                  aria-invalid={Boolean(rowErrors.ballotpediaUrl)}
                  placeholder="https://ballotpedia.org/…"
                />
                {rowErrors.ballotpediaUrl && (
                  <p className="text-sm text-destructive">
                    {rowErrors.ballotpediaUrl}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor={`opponent-website-${index}`}>
                  Website{' '}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Input
                  id={`opponent-website-${index}`}
                  value={row.website}
                  onChange={(e) => updateRow(index, 'website', e.target.value)}
                  aria-invalid={Boolean(rowErrors.website)}
                  placeholder="https://janedoe.com"
                />
                {rowErrors.website && (
                  <p className="text-sm text-destructive">
                    {rowErrors.website}
                  </p>
                )}
              </div>
            </Card>
          )
        })}

        <div>
          <Button
            type="button"
            variant="outline"
            onClick={addRow}
            disabled={!canAddRow}
            className="flex items-center gap-1.5"
          >
            <PlusIcon className="size-4" aria-hidden />
            Add another opponent
          </Button>
        </div>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!hasNamedRow}
            loading={submitting}
            loadingText="Starting…"
          >
            Run the analysis
          </Button>
        </div>

        <p className="text-sm text-muted-foreground">
          You can add more opponents later from your race page.
        </p>
      </form>
    </div>
  )
}

export default AddOpponentsForm
