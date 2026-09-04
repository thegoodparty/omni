'use client'

import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import type { InviteMemberResponse } from 'gpApi/api-endpoints'
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { extractApiErrorInfo } from 'helpers/extractApiErrorInfo'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

const INVITE_ERROR_FALLBACK =
  'Something went wrong sending the invite. Please try again.'

// 409 covers both server-side reasons an invite can't go out (already a
// member, or an invite already pending for this email) — surface gp-api's own
// message rather than a generic one, since the two read differently.
const toInviteErrorMessage = (error: unknown): string =>
  (error instanceof FetchError &&
    error.status === 409 &&
    extractApiErrorInfo(error.data).message) ||
  INVITE_ERROR_FALLBACK

interface InviteMemberDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInvited: (response: InviteMemberResponse) => void
}

const InviteMemberDialog = ({
  open,
  onOpenChange,
  onInvited,
}: InviteMemberDialogProps): React.JSX.Element => {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setEmail('')
      setName('')
      setErrorMessage(null)
      trackEvent(EVENTS.Team.InviteModalOpened)
    }
  }, [open])

  const inviteMutation = useMutation({
    mutationFn: () =>
      clientRequest('POST /v1/organizations/team/invites', {
        email: email.trim(),
        name: name.trim(),
        role: 'campaignAdmin',
      }).then((res) => res.data),
    onSuccess: (response) => {
      trackEvent(EVENTS.Team.InviteSubmitted, { status: response.status })
      onOpenChange(false)
      onInvited(response)
    },
    onError: (error: unknown) => setErrorMessage(toInviteErrorMessage(error)),
  })

  const trimmedEmail = email.trim()
  const trimmedName = name.trim()
  const canSubmit =
    trimmedEmail.length > 0 &&
    trimmedName.length > 0 &&
    !inviteMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-member-name">Name</Label>
            <Input
              id="invite-member-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setErrorMessage(null)
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-member-email">Email</Label>
            <Input
              id="invite-member-email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                setErrorMessage(null)
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-member-role">Role</Label>
            <Input id="invite-member-role" value="Campaign Manager" disabled />
          </div>

          {errorMessage && (
            <p className="m-0 text-sm text-destructive">{errorMessage}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            loading={inviteMutation.isPending}
            onClick={() => inviteMutation.mutate()}
          >
            Send invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default InviteMemberDialog
