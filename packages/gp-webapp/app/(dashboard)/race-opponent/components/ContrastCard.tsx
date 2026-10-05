'use client'

import { useState } from 'react'
import { Button, Card, Textarea } from '@styleguide'
import {
  BookOpenIcon,
  CheckIcon,
  ExternalLinkIcon,
  InfoIcon,
  MessageSquareIcon,
  PencilIcon,
  XMarkIcon,
} from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { reportErrorToSentry } from '@shared/sentry'
import type { ContrastRecord, ContrastRouteTarget } from 'gpApi/api-endpoints'

// Sourced-or-silent: a contrast is only renderable when every one of its six
// content fields is present and non-empty — especially sourceUrl. A contrast
// missing its source link must never reach the candidate, so the card itself
// refuses to render one. The list also filters these out, but this is the
// last-line runtime guard the AC requires.
export const isRenderableContrast = (contrast: ContrastRecord): boolean =>
  Boolean(
    contrast.opponentFact?.trim() &&
    contrast.sourceUrl?.trim() &&
    contrast.candidateFact?.trim() &&
    contrast.contrastSentence?.trim() &&
    contrast.issueTag?.trim() &&
    contrast.routing,
  )

type Props = {
  contrast: ContrastRecord
  onChange: (updated: ContrastRecord) => void
}

const ContrastCard = ({ contrast, onChange }: Props): React.JSX.Element => {
  const [editing, setEditing] = useState(false)
  const [sentence, setSentence] = useState(contrast.contrastSentence)
  const [candidateFact, setCandidateFact] = useState(contrast.candidateFact)
  const [saving, setSaving] = useState(false)
  const [routing, setRouting] = useState<ContrastRouteTarget | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isUsed = contrast.status === 'used'

  const startEdit = (): void => {
    setSentence(contrast.contrastSentence)
    setCandidateFact(contrast.candidateFact)
    setError(null)
    setEditing(true)
  }

  const cancelEdit = (): void => {
    setEditing(false)
    setError(null)
  }

  const saveEdit = async (): Promise<void> => {
    const trimmedSentence = sentence.trim()
    const trimmedFact = candidateFact.trim()
    if (!trimmedSentence || !trimmedFact) {
      setError('Both the contrast and your fact need text.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const { data } = await clientRequest(
        'PATCH /v1/campaigns/mine/race-opponent/contrasts/:id',
        {
          id: String(contrast.id),
          contrastSentence: trimmedSentence,
          candidateFact: trimmedFact,
        },
      )
      onChange(data.contrast)
      setEditing(false)
    } catch (err) {
      reportErrorToSentry(err, {
        context: 'ContrastCard.saveEdit',
        contrastId: contrast.id,
      })
      setError("Couldn't save your edit. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  const route = async (target: ContrastRouteTarget): Promise<void> => {
    setRouting(target)
    setError(null)
    try {
      const { data } = await clientRequest(
        'POST /v1/campaigns/mine/race-opponent/contrasts/:id/route',
        { id: String(contrast.id), target },
      )
      onChange(data.contrast)
    } catch (err) {
      reportErrorToSentry(err, {
        context: 'ContrastCard.route',
        contrastId: contrast.id,
        target,
      })
      setError("Couldn't route this contrast. Please try again.")
    } finally {
      setRouting(null)
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <span className="rounded-full bg-primary/5 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
          {contrast.issueTag}
        </span>
        {isUsed && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
            <CheckIcon className="size-3.5" aria-hidden />
            Routed as draft
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Opponent
          </span>
          <p className="text-sm text-foreground">{contrast.opponentFact}</p>
          <a
            href={contrast.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-semibold text-info-600 hover:underline"
          >
            <span className="break-all">Source</span>
            <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
          </a>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Your position
          </span>
          {editing ? (
            <Textarea
              value={candidateFact}
              onChange={(e) => setCandidateFact(e.target.value)}
              className="min-h-16"
              placeholder="Your fact"
            />
          ) : (
            <p className="text-sm text-foreground">{contrast.candidateFact}</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Contrast
          </span>
          {editing ? (
            <Textarea
              value={sentence}
              onChange={(e) => setSentence(e.target.value)}
              className="min-h-20"
              placeholder="The contrast sentence"
            />
          ) : (
            <p className="text-base text-foreground">
              {contrast.contrastSentence}
            </p>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* No-send disclosure: routing a contrast only creates a draft. The
          candidate's own later action is what sends. The AC requires this to be
          visible. */}
      <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Routing creates a draft only. No auto-send — nothing goes out until
          you send it yourself.
        </span>
      </p>

      {editing ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            icon={<XMarkIcon />}
            onClick={cancelEdit}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            icon={<CheckIcon />}
            onClick={saveEdit}
            loading={saving}
            loadingText="Saving…"
          >
            Save edit
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            variant="outline"
            icon={<PencilIcon />}
            onClick={startEdit}
            disabled={isUsed || routing !== null}
          >
            Edit
          </Button>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              icon={<BookOpenIcon />}
              onClick={() => route('story')}
              loading={routing === 'story'}
              loadingText="Routing…"
              disabled={isUsed || routing !== null}
            >
              Route to Story
            </Button>
            <Button
              variant="outline"
              icon={<MessageSquareIcon />}
              onClick={() => route('texting')}
              loading={routing === 'texting'}
              loadingText="Routing…"
              disabled={isUsed || routing !== null}
            >
              Route to Texting
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

export default ContrastCard
