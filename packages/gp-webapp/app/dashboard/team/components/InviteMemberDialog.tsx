'use client'

import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
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
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { toInviteErrorMessage } from '../team.util'

interface InviteMemberDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInvited: (response: InviteMemberResponse) => void
  // List-scoped volunteer invite (ENG-11056): the outreach drawer's Assign
  // action invites a brand-new volunteer straight onto one list, reusing this
  // dialog's form + inline-error handling rather than forking it. Omitted
  // (default 'campaignAdmin') keeps the team page's general invite unchanged.
  role?: 'campaignAdmin' | 'volunteer'
  outreachId?: number
}

const InviteMemberDialog = ({
  open,
  onOpenChange,
  onInvited,
  role = 'campaignAdmin',
  outreachId,
}: InviteMemberDialogProps): React.JSX.Element => {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const roleLabel = role === 'volunteer' ? 'Volunteer' : 'Campaign Manager'

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
        role,
        ...(outreachId !== undefined ? { outreachId } : {}),
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
          <DialogTitle>
            {role === 'volunteer'
              ? 'Invite a volunteer'
              : 'Invite a team member'}
          </DialogTitle>
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
            <Input id="invite-member-role" value={roleLabel} disabled />
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
