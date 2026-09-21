import { Metadata } from 'next'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Callout, Container, Heading, Text } from '@radix-ui/themes'
import type { OutreachAwaitingResultsItem } from '@goodparty_org/contracts'
import { PERMISSIONS } from '@/lib/permissions'
import { getAwaitingResults } from './actions'
import { isEndpointsUnavailable } from './gateway'
import { AwaitingResultsTable } from './components/AwaitingResultsTable'
import { EndpointsPendingCallout } from './components/EndpointsPendingCallout'

export const metadata: Metadata = {
  title: 'Outreach Results | GP Admin',
  description: 'Sends awaiting results from fulfilment',
}

export const dynamic = 'force-dynamic'

export default async function Page() {
  const { has, orgId } = await auth()
  if (!has?.({ permission: PERMISSIONS.READ_CAMPAIGNS }) || !orgId) {
    redirect('/dashboard/users')
  }

  let items: OutreachAwaitingResultsItem[] = []
  let pending = false
  let error: string | null = null
  try {
    ;({ items } = await getAwaitingResults())
  } catch (err) {
    if (isEndpointsUnavailable(err)) {
      pending = true
    } else {
      error = err instanceof Error ? err.message : 'Could not load the queue'
    }
  }

  return (
    <Container size="4">
      <Heading size="6" mb="1">
        Outreach results
      </Heading>
      <Text color="gray" size="2">
        Every send whose replies have not come back yet. Open one to upload the
        results file fulfilment produced — the page checks it against the send
        before anything is saved.
      </Text>
      {pending ? (
        <EndpointsPendingCallout />
      ) : error ? (
        <Callout.Root color="red" mt="4">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      ) : (
        <AwaitingResultsTable items={items} />
      )}
    </Container>
  )
}
