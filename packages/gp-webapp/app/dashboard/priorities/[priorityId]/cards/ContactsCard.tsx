import { useQueries } from '@tanstack/react-query'
import type { ChatCard, Person } from '@goodparty_org/contracts'
import { CardLoading, CardNote, CardShell } from './cardShell'
import { cardContactQueryOptions } from './cardQueries'

export const SERVE_CONTACTS_CARD_COPY = {
  unnamed: 'Unnamed contact',
}

const contactName = (person: Person) =>
  [person.firstName, person.lastName, person.nameSuffix]
    .filter(Boolean)
    .map((part) => part?.trim())
    .join(' ') || SERVE_CONTACTS_CARD_COPY.unnamed

const contactWhere = (person: Person) =>
  [person.address.line1, person.address.city].filter(Boolean).join(', ')

const ContactRow = ({ person }: { person: Person }) => {
  const where = contactWhere(person)
  return (
    <a
      href={`/dashboard/contacts/${person.id}`}
      className="hover:bg-muted/50 -mx-2 flex min-w-0 flex-col rounded-lg px-2 py-2 no-underline"
    >
      <span className="truncate text-sm font-medium">
        {contactName(person)}
      </span>
      {where ? (
        <span className="text-muted-foreground truncate text-xs">{where}</span>
      ) : null}
    </a>
  )
}

export const ContactsCard = ({
  card,
}: {
  card: Extract<ChatCard, { kind: 'contacts' }>
}) => {
  const results = useQueries({
    queries: card.contactIds.map((id) => cardContactQueryOptions(id)),
  })

  if (results.some((result) => result.isPending)) {
    return <CardLoading rows={card.contactIds.length} />
  }

  const people = results
    .map((result) => result.data)
    .filter((person): person is Person => Boolean(person))

  // Every id gone means there is nothing here worth a frame around it.
  if (people.length === 0) return null

  return (
    <CardShell>
      <div className="flex flex-col">
        {people.map((person) => (
          <ContactRow key={person.id} person={person} />
        ))}
      </div>
      <div className="mt-3">
        <CardNote>{card.note}</CardNote>
      </div>
    </CardShell>
  )
}
