import { useQueries } from '@tanstack/react-query'
import type { ChatCard, Person } from '@goodparty_org/contracts'
import { Avatar } from '@styleguide'
import { ChevronRightIcon, UsersIcon } from '@styleguide/components/ui/icons'
import { CardDetail } from './cardDetail'
import {
  CompactCard,
  CompactCardLoading,
  DetailHeader,
  DetailSection,
  InitialsAvatar,
} from './cardShell'
import { cardContactQueryOptions } from './cardQueries'

export const SERVE_CONSTITUENTS_CARD_COPY = {
  unnamed: 'Unnamed contact',
  title: (n: number) => (n === 1 ? '1 constituent' : `${n} constituents`),
  why: 'Why these people',
  people: 'People',
}

const contactName = (person: Person) =>
  [person.firstName, person.lastName, person.nameSuffix]
    .filter(Boolean)
    .map((part) => part?.trim())
    .join(' ') || SERVE_CONSTITUENTS_CARD_COPY.unnamed

const contactWhere = (person: Person) =>
  [person.address.line1, person.address.city].filter(Boolean).join(', ')

// The contacts page opens its own person panel from this path, so a row lands
// on the constituent's full record rather than a second copy of it.
const ContactRow = ({ person }: { person: Person }) => {
  const where = contactWhere(person)
  const name = contactName(person)
  return (
    <a
      href={`/dashboard/contacts/${person.id}`}
      className="hover:bg-muted/50 -mx-2 flex min-w-0 items-center gap-3 rounded-lg px-2 py-2 no-underline"
    >
      <InitialsAvatar name={name} size="small" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{name}</span>
        {where ? (
          <span className="text-muted-foreground truncate text-xs">
            {where}
          </span>
        ) : null}
      </span>
      <ChevronRightIcon
        className="text-muted-foreground size-4 shrink-0"
        aria-hidden
      />
    </a>
  )
}

const StackedInitials = ({ people }: { people: Person[] }) => (
  <span className="flex -space-x-3">
    {people.slice(0, 3).map((person) => (
      <InitialsAvatar
        key={person.id}
        name={contactName(person)}
        size="small"
        className="ring-card ring-2"
      />
    ))}
  </span>
)

export const ConstituentsCard = ({
  card,
  detailKey,
}: {
  card: Extract<ChatCard, { kind: 'constituents' }>
  detailKey?: string
}) => {
  const results = useQueries({
    queries: card.contactIds.map((id) => cardContactQueryOptions(id)),
  })

  if (results.some((result) => result.isPending)) {
    return <CompactCardLoading />
  }

  const people = results
    .map((result) => result.data)
    .filter((person): person is Person => Boolean(person))

  // Every id gone means there is nothing here worth a frame around it.
  if (people.length === 0) return null

  const title = SERVE_CONSTITUENTS_CARD_COPY.title(people.length)

  return (
    <CardDetail
      {...(detailKey !== undefined && { detailKey })}
      title={title}
      chip={({ open, expanded }) => (
        <CompactCard
          leading={<StackedInitials people={people} />}
          title={title}
          subtitle={card.note}
          expanded={expanded}
          onOpen={open}
        />
      )}
    >
      <div className="flex flex-col gap-5">
        <DetailHeader
          leading={
            <Avatar size="large" aria-hidden>
              <Avatar.Icon>
                <UsersIcon />
              </Avatar.Icon>
            </Avatar>
          }
          title={title}
        />
        <DetailSection label={SERVE_CONSTITUENTS_CARD_COPY.why}>
          <p className="text-sm">{card.note}</p>
        </DetailSection>
        <DetailSection label={SERVE_CONSTITUENTS_CARD_COPY.people}>
          <div className="flex flex-col">
            {people.map((person) => (
              <ContactRow key={person.id} person={person} />
            ))}
          </div>
        </DetailSection>
      </div>
    </CardDetail>
  )
}
