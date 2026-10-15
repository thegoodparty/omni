import { Metadata } from 'next'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Box, Container, Heading, Text } from '@radix-ui/themes'
import { PERMISSIONS } from '@/lib/permissions'
import { getPollQueue } from './actions'
import { PollQueue } from './components/PollQueue'

export const metadata: Metadata = {
  title: 'Poll approvals | GP Admin',
  description: 'Approve and monitor paid polls and expansions',
}

export const dynamic = 'force-dynamic'

export default async function Page() {
  const { has, orgId } = await auth()
  if (!has?.({ permission: PERMISSIONS.READ_CAMPAIGNS }) || !orgId) {
    redirect('/dashboard/users')
  }

  const items = await getPollQueue()

  return (
    <Container size="4">
      <Box>
        <Heading size="6" mb="1">
          Poll approvals
        </Heading>
        <Text color="gray" size="2">
          Paid polls and expansions wait here. Nothing sends until one admin
          approves it.
        </Text>
      </Box>
      <PollQueue items={items} />
    </Container>
  )
}
