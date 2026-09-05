'use client'

import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import type { InviteMemberResponse } from 'gpApi/api-endpoints'
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  Input,
  Label,
  Stepper,
  ToggleGroup,
  ToggleGroupItem,
} from '@styleguide'
import { ShieldCheckIcon, UserRoundIcon } from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { ROLE_DESCRIPTIONS, toInviteErrorMessage } from '../team.util'

type InviteRole = 'campaignAdmin' | 'volunteer'

// Locked labels + icons for the two role cards (ENG-11058 design). Icons
// match the ones already established for these two roles on TeamPage's
// Manage menu (ShieldCheckIcon / UserRoundIcon), so the role reads the same
// way everywhere it's pickable in this feature.
const ROLE_OPTIONS: {
  role: InviteRole
  label: string
  icon: React.ReactNode
}[] = [
  {
    role: 'campaignAdmin',
    label: 'Campaign Manager',
    icon: <ShieldCheckIcon className="size-5" />,
  },
  {
    role: 'volunteer',
    label: 'Volunteer',
    icon: <UserRoundIcon className="size-5" />,
  },
]

const ROLE_CARD_CLASSNAME =
  'h-auto w-full items-start justify-start gap-3 whitespace-normal rounded-xl border border-border bg-card p-4 text-left data-[state=on]:border-tertiary-dark data-[state=on]:bg-tertiary-light'

interface InviteMemberDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInvited: (response: InviteMemberResponse) => void
}

// The team page's Invite (design correction, ENG-11058): a two-step bottom
// drawer — step 1 collects name/phone/email, step 2 picks the role,
// including Volunteer (superseding the role-locked single-step dialog for
// THIS entry point only). The outreach drawer's list-scoped invite keeps
// using InviteMemberDialog unchanged, since it always knows its role and
// outreachId up front and has no step to pick either.
const InviteMemberDrawer = ({
  open,
  onOpenChange,
  onInvited,
}: InviteMemberDrawerProps): React.JSX.Element => {
  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InviteRole | ''>('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setStep(1)
      setName('')
      setPhone('')
      setEmail('')
      setRole('')
      setErrorMessage(null)
      trackEvent(EVENTS.Team.InviteModalOpened)
    }
  }, [open])

  const inviteMutation = useMutation({
    mutationFn: () =>
      clientRequest('POST /v1/organizations/team/invites', {
        email: email.trim(),
        name: name.trim(),
        role: role as InviteRole,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      }).then((res) => res.data),
    onSuccess: (response) => {
      trackEvent(EVENTS.Team.InviteSubmitted, { status: response.status })
      onOpenChange(false)
      onInvited(response)
    },
    onError: (error: unknown) => {
      setErrorMessage(toInviteErrorMessage(error))
      // A 400 is InviteTeamMemberDto's own validation failing (e.g. an
      // invalid phone via PhoneSchema) — that field lives on step 1, so
      // showing the message on step 2 leaves it with nothing to point at.
      // A 409 (already a member/pending) is about the email, also step 1,
      // but stays on step 2 — the role the candidate is mid-picking is a
      // real in-progress choice a network error shouldn't discard.
      if (error instanceof FetchError && error.status === 400) {
        setStep(1)
      }
    },
  })

  const trimmedName = name.trim()
  const trimmedEmail = email.trim()
  const canContinue = trimmedName.length > 0 && trimmedEmail.length > 0
  const canSubmit = canContinue && role !== '' && !inviteMutation.isPending

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        closeClassName="top-4 right-4"
        // Never dismiss mid-submit — a stray outside click or Escape while
        // the invite request is in flight must not tear down the drawer out
        // from under the pending mutation.
        onInteractOutside={(event) => {
          if (inviteMutation.isPending) event.preventDefault()
        }}
      >
        <DrawerHandle />
        <DrawerHeader className="gap-3 px-6 pt-2 pb-4">
          <DrawerTitle>
            {step === 1
              ? 'Who do you want to invite?'
              : 'What role would you like to assign?'}
          </DrawerTitle>
          <Stepper variant="bar" currentStep={step} totalSteps={2} />
        </DrawerHeader>

        <DrawerBody className="px-6 pb-2">
          {step === 1 ? (
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
                <Label htmlFor="invite-member-phone">Phone number</Label>
                <Input
                  id="invite-member-phone"
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
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
            </div>
          ) : (
            <ToggleGroup
              type="single"
              aria-label="Role"
              value={role}
              onValueChange={(value) => {
                setRole(value as InviteRole | '')
                setErrorMessage(null)
              }}
              className="flex w-full flex-col items-stretch gap-3"
            >
              {ROLE_OPTIONS.map((option) => (
                <ToggleGroupItem
                  key={option.role}
                  value={option.role}
                  className={ROLE_CARD_CLASSNAME}
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-tertiary-light text-tertiary-dark">
                    {option.icon}
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium text-foreground">
                      {option.label}
                    </span>
                    <span className="text-sm font-normal text-muted-foreground">
                      {ROLE_DESCRIPTIONS[option.role]}
                    </span>
                  </span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}

          {errorMessage && (
            <p className="m-0 mt-4 text-sm text-destructive">{errorMessage}</p>
          )}
        </DrawerBody>

        <DrawerFooter className="flex-row justify-between gap-2 border-t border-border bg-background px-6 py-4">
          {step === 2 ? (
            <Button variant="outline" onClick={() => setStep(1)}>
              Back
            </Button>
          ) : (
            <span />
          )}
          {step === 1 ? (
            <Button disabled={!canContinue} onClick={() => setStep(2)}>
              Continue
            </Button>
          ) : (
            <Button
              disabled={!canSubmit}
              loading={inviteMutation.isPending}
              onClick={() => inviteMutation.mutate()}
            >
              Send invite
            </Button>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

export default InviteMemberDrawer
