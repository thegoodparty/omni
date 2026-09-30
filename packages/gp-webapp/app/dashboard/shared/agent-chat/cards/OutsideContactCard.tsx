import { useState } from 'react'
import type { ChatCard } from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  MailIcon,
  PhoneIcon,
} from '@styleguide/components/ui/icons'
import { CardNote, CardShell } from './cardShell'

export const SERVE_OUTSIDE_CONTACT_CARD_COPY = {
  askFor: 'Ask for',
  script: 'What to say',
  copyScript: 'Copy script',
  copied: 'Copied',
  call: 'Call',
  email: 'Email',
  site: 'Visit their site',
}

// A number a tel: link can dial.
const telHref = (phone: string) => `tel:${phone.replace(/[^0-9+]/g, '')}`

// The script rides in the body, so the email opens written rather than blank.
const mailtoHref = (email: string, script: string) =>
  `mailto:${email}?body=${encodeURIComponent(script)}`

const CopyScriptButton = ({ script }: { script: string }) => {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="small"
      icon={
        copied ? (
          <CheckIcon className="size-4" aria-hidden />
        ) : (
          <CopyIcon className="size-4" aria-hidden />
        )
      }
      onClick={async () => {
        await navigator.clipboard.writeText(script)
        setCopied(true)
      }}
    >
      {copied
        ? SERVE_OUTSIDE_CONTACT_CARD_COPY.copied
        : SERVE_OUTSIDE_CONTACT_CARD_COPY.copyScript}
    </Button>
  )
}

export const OutsideContactCard = ({
  card,
}: {
  card: Extract<ChatCard, { kind: 'outside_contact' }>
}) => (
  <CardShell className="gap-4">
    <div className="flex min-w-0 flex-col">
      <span className="truncate text-sm font-medium">{card.name}</span>
      <span className="text-muted-foreground truncate text-xs">
        {card.role}
      </span>
    </div>
    <CardNote>{card.why}</CardNote>
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs font-semibold">
        {SERVE_OUTSIDE_CONTACT_CARD_COPY.askFor}
      </span>
      <p className="text-sm">{card.askFor}</p>
    </div>
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs font-semibold">
          {SERVE_OUTSIDE_CONTACT_CARD_COPY.script}
        </span>
        <CopyScriptButton script={card.script} />
      </div>
      <p className="bg-muted/40 rounded-lg p-3 text-sm whitespace-pre-wrap">
        {card.script}
      </p>
    </div>
    {card.phone || card.email || card.url ? (
      <div className="flex flex-wrap gap-2">
        {card.phone ? (
          <Button asChild size="small">
            <a href={telHref(card.phone)}>
              <PhoneIcon className="size-4" aria-hidden />
              {SERVE_OUTSIDE_CONTACT_CARD_COPY.call}
            </a>
          </Button>
        ) : null}
        {card.email ? (
          <Button
            asChild
            size="small"
            variant={card.phone ? 'outline' : 'default'}
          >
            <a href={mailtoHref(card.email, card.script)}>
              <MailIcon className="size-4" aria-hidden />
              {SERVE_OUTSIDE_CONTACT_CARD_COPY.email}
            </a>
          </Button>
        ) : null}
        {card.url ? (
          <Button
            asChild
            size="small"
            variant={card.phone || card.email ? 'outline' : 'default'}
          >
            <a href={card.url} target="_blank" rel="noreferrer">
              <ExternalLinkIcon className="size-4" aria-hidden />
              {SERVE_OUTSIDE_CONTACT_CARD_COPY.site}
            </a>
          </Button>
        ) : null}
      </div>
    ) : null}
  </CardShell>
)
