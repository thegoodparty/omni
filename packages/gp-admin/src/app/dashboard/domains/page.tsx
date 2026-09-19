import { Metadata } from 'next'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Callout, Container, Heading, Text } from '@radix-ui/themes'
import { HiInformationCircle } from 'react-icons/hi'
import { PERMISSIONS } from '@/lib/permissions'
import { DomainAuthCodeForm } from './components/DomainAuthCodeForm'

export const metadata: Metadata = {
  title: 'Domain Transfers | GP Admin',
  description: 'Issue the auth code a candidate needs to move their domain',
}

export default async function Page() {
  const { has, orgId } = await auth()

  if (!has?.({ permission: PERMISSIONS.WRITE_CAMPAIGNS }) || !orgId) {
    redirect('/dashboard/users')
  }

  return (
    <Container size="3">
      <Heading size="6" mb="2">
        Domain Transfers
      </Heading>

      <Text as="p" size="2" color="gray" mb="4">
        Candidates who want to move their domain to another registrar need an
        auth code (also called an EPP or transfer code). GoodParty is the
        registrant of record, so we are the only party who can produce one.
      </Text>

      <Callout.Root color="amber" mb="4">
        <Callout.Icon>
          <HiInformationCircle />
        </Callout.Icon>
        <Callout.Text>
          Verify the requester is the candidate or a listed campaign contact
          before sending this on. The code lets whoever holds it move the domain
          away, and it is not revocable once shared. Send it directly to the
          candidate — not into a shared channel.
        </Callout.Text>
      </Callout.Root>

      <DomainAuthCodeForm />
    </Container>
  )
}
