import { useState } from 'react'
import type { ChatCard } from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import {
  CheckIcon,
  CircleHelpIcon,
  CopyIcon,
  ExternalLinkIcon,
  MailIcon,
  MessageSquareIcon,
  PhoneIcon,
  UserRoundIcon,
} from '@styleguide/components/ui/icons'
import { InfoSection } from 'app/dashboard/contacts/crm/person/InfoSection'
import { CardDetail } from './cardDetail'
import { CompactCard } from './cardShell'

export const SERVE_OUTSIDE_CONTACT_CARD_COPY = {
  why: 'Why reach out',
  askFor: 'Who to ask for',
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
      variant="outline"
      size="small"
      className="self-start"
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

// Laid out the way the contacts page lays out a person (PersonOverlay): the
// name as the page heading, one line under it, then one InfoSection card per
// thing to know, so a researched contact and a constituent read alike.
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
        title={card.name}
        subtitle={card.role}
        expanded={expanded}
        onOpen={open}
      />
    )}
  >
    <div>
      <h2 className="pt-4 pb-2 text-3xl font-semibold">{card.name}</h2>
      <p className="mb-6 text-xl font-semibold">{card.role}</p>
      <div className="flex flex-col gap-6">
        <ContactActions card={card} />
        <InfoSection
          title={SERVE_OUTSIDE_CONTACT_CARD_COPY.why}
          icon={<CircleHelpIcon className="size-6" aria-hidden />}
        >
          <p className="text-md">{card.why}</p>
        </InfoSection>
        <InfoSection
          title={SERVE_OUTSIDE_CONTACT_CARD_COPY.askFor}
          icon={<UserRoundIcon className="size-6" aria-hidden />}
        >
          <p className="text-md">{card.askFor}</p>
        </InfoSection>
        <InfoSection
          title={SERVE_OUTSIDE_CONTACT_CARD_COPY.script}
          icon={<MessageSquareIcon className="size-6" aria-hidden />}
        >
          <p className="text-md whitespace-pre-wrap">{card.script}</p>
          <CopyScriptButton script={card.script} />
        </InfoSection>
      </div>
    </div>
  </CardDetail>
)
