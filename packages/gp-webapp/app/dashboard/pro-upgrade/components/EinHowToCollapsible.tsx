'use client'

import { useState } from 'react'
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@styleguide'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ExternalLinkIcon,
} from '@styleguide/components/ui/icons'
import Body2 from '@shared/typography/Body2'

const IRS_EIN_URL = 'https://sa.www4.irs.gov/applyein/legalStructure'

const STEPS = [
  "Go to IRS.gov and open the EIN Assistant (search 'Apply for an EIN online').",
  "Choose 'View additional types', then select 'Political organization' as your entity type.",
  "Enter the responsible party's name and SSN or ITIN.",
  "Enter your campaign committee's legal name and address.",
  'Answer the short questionnaire about your organization.',
  "Submit, you'll get your EIN right away and can download the confirmation letter.",
]

export const EinHowToCollapsible = (): React.JSX.Element => {
  const [open, setOpen] = useState(false)

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-xl border border-base-border"
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 p-4 text-left">
        <span>
          <span className="font-semibold">How to get a free EIN </span>
          <span className="text-base-muted-foreground">(3 to 5 min)</span>
        </span>
        {open ? (
          <ChevronUpIcon
            className="size-5 text-base-muted-foreground"
            aria-hidden
          />
        ) : (
          <ChevronDownIcon
            className="size-5 text-base-muted-foreground"
            aria-hidden
          />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4">
        <ol className="rounded-lg border border-base-border">
          {STEPS.map((text, index) => (
            <li
              key={text}
              className="flex gap-3 border-t border-base-border px-3.5 py-3 first:border-t-0"
            >
              <span className="min-w-4 text-sm font-semibold text-primary">
                {index + 1}.
              </span>
              <span className="text-sm leading-relaxed">{text}</span>
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Body2 className="w-full text-base-muted-foreground">
            The online tool is open Monday to Friday and issues your EIN
            immediately.
          </Body2>
          <Button asChild variant="ghost" size="small">
            <a href={IRS_EIN_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon /> Open IRS.gov
            </a>
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
