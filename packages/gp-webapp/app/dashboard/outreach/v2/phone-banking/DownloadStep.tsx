'use client'

import type { PhoneBankingCreateResponse } from '@goodparty_org/contracts'
import { Alert, AlertDescription, Button, Card } from '@styleguide'
import { DownloadIcon } from '@styleguide/components/ui/icons'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { CHANNEL_META } from '../channelMeta'
import { Intro } from '../social/Intro'

interface DownloadStepProps {
  response: PhoneBankingCreateResponse
  audienceLabel: string
}

// The "ready" screen (step 5): replaces the old naming-only download step and
// the separate SuccessScreen. Rendered only once the create call has already
// succeeded, so there's nothing left to input here — just the summary and the
// download/next-step actions.
export const DownloadStep = ({
  response,
  audienceLabel,
}: DownloadStepProps) => {
  const isZip = response.sheetCount > 1
  const href = `/dashboard/outreach/phone-banking/print/${response.id}/pdf`

  const handleDownloadClick = () => {
    trackEvent(EVENTS.Outreach.PhoneBanking.SheetDownloaded, {
      listId: response.id,
      contactCount: response.personCount,
    })
  }

  return (
    <div className="space-y-6">
      <Intro
        channel="phoneBanking"
        title={
          isZip ? 'Your call sheets are ready' : 'Your call sheet is ready'
        }
        body={`Download the ${isZip ? 'PDFs' : 'PDF'} for your volunteers, then go to the calling page to start making calls and marking outcomes.`}
      />

      {/* hasMore is the server's post-freeze truth; no client arithmetic
          against the audience step's reachableCount here — that figure
          counts the whole saved list, including people already consumed by
          prior batches, so any "frozen from M" comparison lies on a
          continuation batch (same reasoning as SheetCountStep's
          over-capacity copy). */}
      {response.hasMore && (
        <Alert variant="destructive">
          <AlertDescription>
            More reachable contacts remain in this list. Create another phone
            banking campaign with this same list to call the rest — it picks up
            where this one left off.
          </AlertDescription>
        </Alert>
      )}

      <Card className="gap-3 p-4 text-sm">
        <div className="flex items-center gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning [&_svg]:size-6">
            {CHANNEL_META.phoneBanking.icon}
          </span>
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              {isZip
                ? `${response.sheetCount} phone banking call sheets`
                : 'Phone banking call sheet'}
            </p>
            <p className="text-sm text-muted-foreground">
              {audienceLabel} · {response.personCount.toLocaleString()} contacts
              {isZip ? ` split across ${response.sheetCount} sheets` : ''}
            </p>
          </div>
        </div>
        <div className="border-t border-border pt-3 text-sm text-muted-foreground">
          <p>The PDF includes:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Your call script</li>
            <li>Contacts with name, phone, and status checkboxes</li>
            <li>
              Statuses: Answered, No answer, Voicemail left, Wrong number,
              Refused
            </li>
            <li>Support (Y / U / N) and notes column</li>
          </ul>
        </div>
      </Card>

      <Button
        asChild
        variant="outline"
        className="w-full"
        onClick={handleDownloadClick}
      >
        {/* The PDF/ZIP is built by a route handler (ENG-10918) — a plain
            anchor, same precedent as door-knocking's print link. */}
        <a href={href} target="_blank" rel="noreferrer">
          <DownloadIcon className="size-4" />
          {isZip
            ? `Download ${response.sheetCount} call sheets (ZIP)`
            : 'Download call sheet (PDF)'}
        </a>
      </Button>
    </div>
  )
}
