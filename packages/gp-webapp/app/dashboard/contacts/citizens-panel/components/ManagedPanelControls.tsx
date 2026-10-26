import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import type {
  ManagedCivicPanel,
  UpdateManagedCivicPanelInput,
} from '@goodparty_org/contracts'
import { Button, Card } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import AlertDialog from '@shared/utils/AlertDialog'
import { useOrganization } from '@shared/organization-picker'
import { managedCivicPanelQueryOptions } from '../civicPanelSummary.query'
import {
  MANAGED_PANEL_COPY,
  managedPanelNextInvitesAt,
  managedPanelReadyWeek,
  monthDay,
  shortDay,
} from '../managedPanelCopy'

const COPY = MANAGED_PANEL_COPY.controls

type Action = UpdateManagedCivicPanelInput['action']

// The panel GoodParty builds for the office: where its invites stand, when
// the next go out and when it should be ready, and the official's say over
// them. Pause holds the next invites, Resume lets
// them go again, and Stop ends the panel. A stopped panel shows nothing
// here: the home offers it again.
export const ManagedPanelControls = ({
  panel: initialPanel,
}: {
  panel: ManagedCivicPanel
}) => {
  const [panel, setPanel] = useState(initialPanel)
  const [confirmingStop, setConfirmingStop] = useState(false)
  const queryClient = useQueryClient()
  const orgSlug = useOrganization()?.slug
  const update = useMutation({
    mutationFn: async (action: Action) => {
      try {
        return (
          await clientRequest('PATCH /v1/contacts/civic-panel/managed', {
            action,
          })
        ).data.panel
      } catch (error) {
        // A 409 means the status moved since the page loaded (a ready civic
        // panel can't resume), so trying again never works: redraw the card
        // in its real state instead.
        if (!(error instanceof FetchError && error.status === 409)) throw error
        return (await clientRequest('GET /v1/contacts/civic-panel/managed', {}))
          .data.panel
      }
    },
    onSuccess: (next) => {
      if (next) setPanel(next)
      queryClient.setQueryData(
        managedCivicPanelQueryOptions(orgSlug).queryKey,
        next,
      )
    },
  })

  if (panel.status === 'stopped') return null
  const { status } = panel
  const canPause = status === 'building'
  const canResume = status === 'paused'
  const nextInvites = managedPanelNextInvitesAt(panel)
  const readyWeek = managedPanelReadyWeek(panel)
  const dates = [
    nextInvites
      ? { label: COPY.nextInvites, value: shortDay(nextInvites) }
      : null,
    readyWeek
      ? { label: COPY.readyAround, value: COPY.weekOf(monthDay(readyWeek)) }
      : null,
  ].filter((row) => row !== null)

  return (
    <Card
      className="flex flex-col gap-4 rounded-xl border-border p-5"
      data-testid="managed-panel-controls"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">{COPY.title}</h2>
        <p className="text-base text-muted-foreground">{COPY.status(status)}</p>
      </div>

      {dates.length > 0 ? (
        <dl className="flex flex-col">
          {dates.map((row) => (
            <div
              key={row.label}
              className="flex items-baseline justify-between gap-3 border-t border-border py-2.5 first:border-t-0"
            >
              <dt className="text-base text-muted-foreground">{row.label}</dt>
              <dd className="text-base font-semibold text-foreground">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="flex flex-col gap-2">
        {canPause ? (
          <Button
            type="button"
            variant="outline"
            size="medium"
            disabled={update.isPending}
            onClick={() => update.mutate('pause')}
          >
            {COPY.pause}
          </Button>
        ) : null}
        {canResume ? (
          <Button
            type="button"
            size="medium"
            disabled={update.isPending}
            onClick={() => update.mutate('resume')}
          >
            {COPY.resume}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="medium"
          disabled={update.isPending}
          onClick={() => setConfirmingStop(true)}
        >
          {COPY.stop}
        </Button>
      </div>
      {update.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {COPY.error}
        </p>
      ) : null}

      <AlertDialog
        open={confirmingStop}
        title={COPY.stopTitle}
        description={COPY.stopCaption}
        cancelLabel={COPY.stopCancel}
        proceedLabel={COPY.stopConfirm}
        handleClose={() => setConfirmingStop(false)}
        handleProceed={() => {
          setConfirmingStop(false)
          update.mutate('stop')
        }}
      />
    </Card>
  )
}
