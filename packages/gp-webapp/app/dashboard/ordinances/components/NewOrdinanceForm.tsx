'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input } from '@styleguide'
import { createOrdinance } from '../data/ordinances-api'

// Minimal intake: capture a goal (and an optional existing-ordinance link),
// create the record, and drop into the guided flow at the Clarify step. The
// full list + priority-issue intake is slice 7.
export default function NewOrdinanceForm(): React.JSX.Element {
  const router = useRouter()
  const [goalText, setGoalText] = useState('')
  const [sourceLink, setSourceLink] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const goal = goalText.trim()
    if (!goal || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const link = sourceLink.trim()
      const ordinance = await createOrdinance({
        seedType: 'new',
        goalText: goal,
        ...(link && { sourceLink: link }),
      })
      router.push(`/dashboard/ordinances/solve/${ordinance.slug}/clarify`)
    } catch {
      setError(
        'Could not create the ordinance. Check your input and try again.',
      )
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4"
    >
      <h1 className="text-lg font-semibold text-primary-dark">New ordinance</h1>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">
          What do you want this ordinance to do?
        </span>
        <Input
          value={goalText}
          onChange={(e) => setGoalText(e.target.value)}
          placeholder="e.g. Limit late-night construction noise"
          disabled={submitting}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">
          Link to an existing ordinance (optional)
        </span>
        <Input
          value={sourceLink}
          onChange={(e) => setSourceLink(e.target.value)}
          placeholder="https://..."
          disabled={submitting}
        />
      </label>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button
        type="submit"
        disabled={submitting || goalText.trim().length === 0}
        className="self-start"
      >
        Start
      </Button>
    </form>
  )
}
