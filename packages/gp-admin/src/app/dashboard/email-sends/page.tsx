import { Metadata } from 'next'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Container, Heading, Text } from '@radix-ui/themes'
import { PERMISSIONS } from '@/lib/permissions'
import { getPausedEmailSends } from './actions'
import { PausedSendsTable } from './components/PausedSendsTable'

export const metadata: Metadata = {
  title: 'Email sends | GP Admin',
  description: 'Resume or cancel paused email sends',
}

export const dynamic = 'force-dynamic'

export default async function Page() {
  const { has, orgId } = await auth()
  if (!has?.({ permission: PERMISSIONS.READ_CAMPAIGNS }) || !orgId) {
    redirect('/dashboard/users')
  }

  const [{ items }, canDecide] = await Promise.all([
    getPausedEmailSends(),
    Promise.resolve(Boolean(has({ role: 'org:admin' }))),
  ])

  return (
    <Container size="4">
      <Heading size="6" mb="1">
        Email sends
      </Heading>
      <Text color="gray" size="2" as="p" mb="4">
        Sends that are paused. Rates are Amazon SES&apos;s numbers since the
        send last resumed.
      </Text>
      <PausedSendsTable items={items} canDecide={canDecide} />
    </Container>
  )
}
