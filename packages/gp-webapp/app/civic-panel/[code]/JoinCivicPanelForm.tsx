'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CIVIC_PANEL_JOIN_CONSENT } from '@goodparty_org/contracts'
import { Button, Checkbox, Input, Label } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { MANAGED_PANEL_COPY } from 'app/dashboard/contacts/citizens-panel/managedPanelCopy'

const COPY = MANAGED_PANEL_COPY.joinPage

// The resident's name, cell number and their yes to the texts. The answer
// is the same whoever submits, so the page never says whether a number was
// already on the panel.
export const JoinCivicPanelForm = ({
  code,
  title,
  caption,
}: {
  code: string
  title: string
  caption: string
}) => {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const join = useMutation({
    mutationFn: () =>
      clientRequest('POST /v1/civic-panel/join/:code', {
        code,
        firstName,
        lastName,
        phone,
        consent: true,
      }),
  })

  if (join.isSuccess) {
    return (
      <div className="flex flex-col gap-2" data-testid="civic-panel-joined">
        <h1 className="text-2xl font-semibold text-foreground">
          {COPY.doneTitle}
        </h1>
        <p className="text-sm text-muted-foreground">{COPY.doneCaption}</p>
      </div>
    )
  }

  const ready =
    firstName.trim() !== '' &&
    lastName.trim() !== '' &&
    phone.replace(/\D/g, '').length >= 10 &&
    consent

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) join.mutate()
      }}
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{caption}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="join-first-name">{COPY.firstName}</Label>
        <Input
          id="join-first-name"
          autoComplete="given-name"
          value={firstName}
          onChange={(event) => setFirstName(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="join-last-name">{COPY.lastName}</Label>
        <Input
          id="join-last-name"
          autoComplete="family-name"
          value={lastName}
          onChange={(event) => setLastName(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="join-phone">{COPY.phone}</Label>
        <Input
          id="join-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id="join-consent"
          checked={consent}
          onCheckedChange={(checked) => setConsent(checked === true)}
          className="mt-1"
        />
        <Label
          htmlFor="join-consent"
          className="text-sm leading-6 font-normal text-foreground"
        >
          {CIVIC_PANEL_JOIN_CONSENT}
        </Label>
      </div>
      {join.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {COPY.error}
        </p>
      ) : null}
      <Button
        type="submit"
        size="large"
        className="w-full"
        disabled={!ready || join.isPending}
      >
        {COPY.submit}
      </Button>
    </form>
  )
}
