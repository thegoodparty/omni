'use client'

import { useState } from 'react'
import {
  Button,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@styleguide'
import {
  ChevronRightIcon,
  ExternalLinkIcon,
  MailIcon,
  PhoneIcon,
} from '@styleguide/components/ui/icons'
import type { OutreachOrg } from '../data/stepProtocol'

// Beat three: the coalitions. A row each, because the detail (who to ask for,
// what to say, how to reach them) is what you want open in front of you when
// you actually make the call, not while you are reading past it.
export default function OrgsCard({
  orgs,
}: {
  orgs: OutreachOrg[]
}): React.JSX.Element {
  const [open, setOpen] = useState<OutreachOrg | null>(null)
  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border border-border bg-card p-4 shadow-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Groups who reach further than your list
      </span>
      {orgs.map((org) => (
        <button
          key={org.name}
          type="button"
          onClick={() => setOpen(org)}
          className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-muted/50"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-foreground">
              {org.name}
            </span>
            <span className="block truncate text-sm text-muted-foreground">
              {org.why}
            </span>
          </span>
          <ChevronRightIcon
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </button>
      ))}
      <OrgSheet
        org={open}
        onOpenChange={(next) => {
          if (!next) setOpen(null)
        }}
      />
    </div>
  )
}

// A number a tel: link can dial.
const telHref = (phone: string): string => phone.replace(/[^0-9+]/g, '')

// The script rides in the body, so the email opens written rather than blank.
const mailtoHref = (org: OutreachOrg): string =>
  `mailto:${org.email ?? ''}?subject=${encodeURIComponent(org.askFor)}&body=${encodeURIComponent(org.script)}`

// The same shape as a contact card: who you are calling, what to ask for, the
// script, and the address or number as something you can actually press.
function OrgSheet({
  org,
  onOpenChange,
}: {
  org: OutreachOrg | null
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  return (
    <Sheet open={org !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{org?.name ?? ''}</SheetTitle>
          <SheetDescription>{org?.why ?? ''}</SheetDescription>
        </SheetHeader>
        {org ? (
          <SheetBody className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Ask for
              </span>
              <p className="text-sm text-foreground">{org.askFor}</p>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                What to say
              </span>
              <p className="whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
                {org.script}
              </p>
            </div>
            {org.phone || org.email ? (
              <div className="flex flex-col gap-3">
                {org.phone ? (
                  <div>
                    <p className="text-xs text-muted-foreground">Phone</p>
                    <a className="underline" href={`tel:${telHref(org.phone)}`}>
                      {org.phone}
                    </a>
                  </div>
                ) : null}
                {org.email ? (
                  <div>
                    <p className="text-xs text-muted-foreground">Email</p>
                    <a className="underline" href={mailtoHref(org)}>
                      {org.email}
                    </a>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* One primary action, in the order the contact is most likely to
                land: a call if there is a number, an email with the script
                already in the body if there is an address, and otherwise
                their site, which is the honest fallback when the agent could
                not find either. */}
            {org.phone ? (
              <Button asChild className="w-full">
                <a href={`tel:${telHref(org.phone)}`}>
                  <PhoneIcon className="size-4" aria-hidden />
                  Call {org.name}
                </a>
              </Button>
            ) : org.email ? (
              <Button asChild className="w-full">
                <a href={mailtoHref(org)}>
                  <MailIcon className="size-4" aria-hidden />
                  Email {org.name}
                </a>
              </Button>
            ) : org.url ? (
              <Button asChild className="w-full">
                <a href={org.url} target="_blank" rel="noreferrer">
                  <ExternalLinkIcon className="size-4" aria-hidden />
                  Find their contact details
                </a>
              </Button>
            ) : null}

            {/* Their site stays reachable when it is not the primary. */}
            {org.url && (org.phone || org.email) ? (
              <Button asChild variant="outline" className="w-full">
                <a href={org.url} target="_blank" rel="noreferrer">
                  <ExternalLinkIcon className="size-4" aria-hidden />
                  Their site
                </a>
              </Button>
            ) : null}
          </SheetBody>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
