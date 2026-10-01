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
import { CardDetail } from './cardDetail'
import {
  CompactCard,
  DetailHeader,
  DetailSection,
  InitialsAvatar,
} from './cardShell'

export const SERVE_OUTSIDE_CONTACT_CARD_COPY = {
  why: 'Why reach out',
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

type OutsideContact = Extract<ChatCard, { kind: 'outside_contact' }>

const ContactActions = ({ card }: { card: OutsideContact }) =>
  card.phone || card.email || card.url ? (
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
  ) : null

export const OutsideContactCard = ({
  card,
  detailKey,
}: {
  card: OutsideContact
  detailKey?: string
}) => (
  <CardDetail
    {...(detailKey !== undefined && { detailKey })}
    title={card.name}
    chip={({ open, expanded }) => (
      <CompactCard
        leading={<InitialsAvatar name={card.name} />}
        title={card.name}
        subtitle={card.role}
        expanded={expanded}
        onOpen={open}
      />
    )}
  >
    <div className="flex flex-col gap-5">
      <DetailHeader
        leading={<InitialsAvatar name={card.name} size="large" />}
        title={card.name}
        subtitle={card.role}
      />
      <ContactActions card={card} />
      <DetailSection label={SERVE_OUTSIDE_CONTACT_CARD_COPY.why}>
        <p className="text-sm">{card.why}</p>
      </DetailSection>
      <DetailSection label={SERVE_OUTSIDE_CONTACT_CARD_COPY.askFor}>
        <p className="text-sm">{card.askFor}</p>
      </DetailSection>
      <DetailSection
        label={SERVE_OUTSIDE_CONTACT_CARD_COPY.script}
        action={<CopyScriptButton script={card.script} />}
      >
        <p className="bg-muted/40 rounded-lg p-3 text-sm whitespace-pre-wrap">
          {card.script}
        </p>
      </DetailSection>
    </div>
  </CardDetail>
)
