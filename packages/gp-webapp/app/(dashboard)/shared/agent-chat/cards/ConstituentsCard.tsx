import { useQueries } from '@tanstack/react-query'
import type { ChatCard, Person } from '@goodparty_org/contracts'
import { useOrganization } from '@shared/organization-picker'
import { PersonRecord } from 'app/(dashboard)/contacts/crm/person/PersonOverlay'
import { CardDetail } from './cardDetail'
import { CompactCard, CompactCardLoading } from './cardShell'
import { cardContactQueryOptions } from './cardQueries'

export const SERVE_CONSTITUENTS_CARD_COPY = {
  unnamed: 'Unnamed contact',
}

const contactName = (person: Person) =>
  [person.firstName, person.lastName, person.nameSuffix]
    .filter(Boolean)
    .map((part) => part?.trim())
    .join(' ') || SERVE_CONSTITUENTS_CARD_COPY.unnamed

const contactWhere = (person: Person) =>
  [person.address.line1, person.address.city].filter(Boolean).join(', ')

// One row per person, each opening that constituent's own record the way the
// contacts page renders it (PersonRecord), in the panel rather than off on
// another page. The parts of that record that read the contacts table's own
// queries (top issues, the activity feed) are not here, and neither is the
// map: the address already says where they live.
export const ConstituentsCard = ({
  card,
  detailKey,
}: {
  card: Extract<ChatCard, { kind: 'constituents' }>
  detailKey?: string
}) => {
  const orgSlug = useOrganization()?.slug
  const results = useQueries({
    queries: card.contactIds.map((id) => cardContactQueryOptions(id, orgSlug)),
  })

  if (results.some((result) => result.isPending)) {
    return <CompactCardLoading />
  }

  const people = results
    .map((result) => result.data)
    .filter((person): person is Person => Boolean(person))

  // Every id gone means there is nothing here worth a frame around it.
  if (people.length === 0) return null

  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      {people.map((person) => {
        const name = contactName(person)
        const where = contactWhere(person)
        return (
          <CardDetail
            key={person.id}
            {...(detailKey !== undefined && {
              detailKey: `${detailKey}:${person.id}`,
            })}
            title={name}
            chip={({ open, expanded }) => (
              <CompactCard
                title={name}
                {...(where && { subtitle: where })}
                expanded={expanded}
                onOpen={open}
              />
            )}
          >
            <PersonRecord
              person={person}
              isServe
              showWinActivities={false}
              showMap={false}
            />
          </CardDetail>
        )
      })}
    </div>
  )
}
