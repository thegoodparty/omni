import { Metadata } from 'next'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Container, Heading, Text } from '@radix-ui/themes'
import { PERMISSIONS } from '@/lib/permissions'
import { getSmsQueue } from './actions'
import { SmsQueue } from './components/SmsQueue'

export const metadata: Metadata = {
  title: 'SMS Outreach | GP Admin',
  description: 'Approve and monitor scheduled SMS campaigns',
}

export const dynamic = 'force-dynamic'

export default async function Page() {
  const { has, orgId } = await auth()
  if (!has?.({ permission: PERMISSIONS.READ_CAMPAIGNS }) || !orgId) {
    redirect('/dashboard/users')
  }

  const { items } = await getSmsQueue()

  return (
    <Container size="4">
      <Heading size="6" mb="1">
        SMS outreach
      </Heading>
      <Text color="gray" size="2">
        Scheduled text campaigns awaiting the one human approval. Approving
        books the vendor&apos;s canvassers; nothing sends without it.
      </Text>
      <SmsQueue items={items} />
    </Container>
  )
}
