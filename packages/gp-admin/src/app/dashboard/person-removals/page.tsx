import { Metadata } from 'next'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Box, Container, Flex, Heading, Text } from '@radix-ui/themes'
import { PERMISSIONS } from '@/lib/permissions'
import { listPersonRemovals } from './actions'
import { AddPersonRemoval } from './components/AddPersonRemoval'
import { PersonRemovalList } from './components/PersonRemovalList'
import { ShowClearedToggle } from './components/ShowClearedToggle'
import { INCLUDE_CLEARED_VALUE, SEARCH_PARAMS } from './types'

export const metadata: Metadata = {
  title: 'Profile Removals | GP Admin',
  description: 'Take a public /people profile down on privacy request',
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function Page({ searchParams }: PageProps) {
  const { has, orgId } = await auth()

  if (!has?.({ permission: PERMISSIONS.MANAGE_PERSON_REMOVALS }) || !orgId) {
    redirect('/dashboard/users')
  }

  const params = await searchParams
  const includeCleared =
    firstValue(params[SEARCH_PARAMS.INCLUDE_CLEARED]) === INCLUDE_CLEARED_VALUE

  const removals = await listPersonRemovals(includeCleared)

  return (
    <Container size="4">
      <Flex justify="between" align="center" mb="2">
        <Heading size="6">Profile Removals</Heading>
        <AddPersonRemoval />
      </Flex>

      <Text as="p" size="2" color="gray" mb="4">
        Takes the public /people page down on privacy request. The page keeps a
        crawlable URL but shows no photo, bio, links or issues, and drops out of
        the sitemap. The subject does not need a GoodParty account.
      </Text>

      <Box mb="4">
        <ShowClearedToggle includeCleared={includeCleared} />
      </Box>

      <PersonRemovalList removals={removals} />
    </Container>
  )
}
