'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button, Input, Textarea } from '@styleguide'
import { XMarkIcon } from '@styleguide/components/ui/icons'
import { AiIcon } from '@styleguide/components/ui/ai-icon'
import { createOrdinance } from '../data/ordinances-api'

// Chat-styled intake (not a real chat): an assistant intro frames the two
// fields. Captures a goal and an optional existing-ordinance link, creates the
// record, and drops into the guided flow at the Clarify step.
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
    <div className="flex h-full w-full flex-col bg-background">
      <header className="border-b border-border py-3">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-6">
          <h1 className="text-base font-semibold text-foreground">
            New ordinance
          </h1>
          <Link
            href="/dashboard/ordinances"
            aria-label="Close"
            className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XMarkIcon className="size-4" aria-hidden />
          </Link>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <form
          onSubmit={(e) => void submit(e)}
          className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6"
        >
          <div className="flex gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <AiIcon className="size-4" aria-hidden />
            </div>
            <div className="rounded-2xl bg-muted px-4 py-3 text-sm text-foreground">
              <p>
                Before we kick off the guided flow, tell me a bit about what you
                have in mind.
              </p>
              <p className="mt-2">
                If there&apos;s an existing ordinance you&apos;re hoping to
                update, share the link. Then let me know what you&apos;re trying
                to accomplish.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-4 pl-11">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">
                Link to the ordinance you want to update{' '}
                <span className="text-muted-foreground">(optional)</span>
              </span>
              <Input
                type="url"
                value={sourceLink}
                onChange={(e) => setSourceLink(e.target.value)}
                placeholder="https://"
                disabled={submitting}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">
                What are you hoping to accomplish?
              </span>
              <Textarea
                value={goalText}
                onChange={(e) => setGoalText(e.target.value)}
                placeholder="Describe the change you want to make and who it helps."
                rows={4}
                disabled={submitting}
              />
            </label>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={submitting || goalText.trim().length === 0}
                className="rounded-full"
              >
                Start guided flow
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
