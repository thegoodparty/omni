import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
  managedPanelNextInvites,
} from '../managedPanelCopy'
import { ManagedPanelJoinLink } from './ManagedPanelJoinLink'

const COPY = MANAGED_PANEL_COPY.controls

type Action = UpdateManagedCivicPanelInput['action']

// The panel GoodParty builds for the office: where its invites stand, and
// the official's say over them. Pause holds the next invites, Resume lets
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
    mutationFn: async (action: Action) =>
      (
        await clientRequest('PATCH /v1/contacts/civic-panel/managed', {
          action,
        })
      ).data.panel,
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

  return (
    <Card
      className="flex flex-col gap-4 rounded-2xl border-components-input-border p-5"
      data-testid="managed-panel-controls"
    >
      <div className="flex flex-col gap-1">
        <h2 className="font-opensans text-lg font-medium text-card-foreground">
          {COPY.title}
        </h2>
        <p className="text-sm text-muted-foreground">
          {COPY.status(
            status,
            managedPanelNextInvites(panel.progress.nextWaveAt),
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          {MANAGED_PANEL_COPY.panelCardStatus(
            status,
            panel.progress.members,
            panel.progress.goalMembers,
          )}
        </p>
      </div>

      <ManagedPanelJoinLink shareCode={panel.shareCode} />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
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
