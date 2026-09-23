'use client'

import { useState } from 'react'
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@styleguide'
import {
  ExternalLinkIcon,
  MailIcon,
  MinusIcon,
  PlusIcon,
} from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

const IRS_EIN_URL = 'https://sa.www4.irs.gov/applyein/legalStructure'

const STEPS = [
  "Go to IRS.gov and open the EIN Assistant (search 'Apply for an EIN online').",
  "Choose 'View additional types', then select 'Political organization' as your entity type.",
  "Enter the responsible party's name and SSN or ITIN.",
  "Enter your campaign committee's legal name and address.",
  'Answer the short questionnaire about your organization.',
  "Submit, you'll get your EIN right away and can download the confirmation letter.",
]

// Design: the EIN step's "How to get a free EIN" card — the six IRS steps,
// then a footer that mails them to the candidate or opens the IRS tool.
export const EinHowToCollapsible = (): React.JSX.Element => {
  const [open, setOpen] = useState(false)
  const [emailing, setEmailing] = useState(false)
  const { errorSnackbar, successSnackbar } = useSnackbar()

  const handleEmail = async (): Promise<void> => {
    if (emailing) return
    setEmailing(true)
    trackEvent(EVENTS.ProUpgrade.Compliance.EinInstructionsEmail)
    try {
      // No body: gp-api sends to the caller's own email.
      await clientRequest('POST /v1/campaigns/mine/ein-instructions/email', {})
      successSnackbar('EIN steps sent to your email.')
    } catch {
      errorSnackbar('Something went wrong. Please try again.')
    } finally {
      setEmailing(false)
    }
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-xl border border-base-border"
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 p-4 text-left">
        <span className="text-[15px]">
          <span className="font-semibold">How to get a free EIN </span>
          <span className="text-base-muted-foreground">(3 to 5 min)</span>
        </span>
        {open ? (
          <MinusIcon
            className="size-[18px] shrink-0 text-base-muted-foreground"
            aria-hidden
          />
        ) : (
          <PlusIcon
            className="size-[18px] shrink-0 text-base-muted-foreground"
            aria-hidden
          />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4">
        <div className="overflow-hidden rounded-xl border border-base-border bg-card">
          <ol>
            {STEPS.map((text, index) => (
              <li
                key={text}
                className="flex min-h-16 items-center gap-3 border-t border-base-border px-4 py-3.5 first:border-t-0"
              >
                <span className="min-w-4 text-sm font-bold text-primary">
                  {index + 1}.
                </span>
                <span className="text-sm leading-relaxed">{text}</span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-3 border-t border-base-border p-3.5">
            <p className="w-full text-[13px] text-base-muted-foreground">
              The online tool is open Monday to Friday and issues your EIN
              immediately.
            </p>
            <Button
              type="button"
              variant="outline"
              size="small"
              loading={emailing}
              onClick={() => void handleEmail()}
            >
              <MailIcon /> Email me these steps
            </Button>
            <Button
              asChild
              variant="ghost"
              size="small"
              className="text-primary"
            >
              <a href={IRS_EIN_URL} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon /> Open IRS.gov
              </a>
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
