import { Metadata } from 'next'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Box, Container, Heading, Text } from '@radix-ui/themes'
import { ROLES } from '@/lib/permissions'
import { listJobDeadLetterQueues, listJobDeadLetters } from './actions'
import { JobDeadLetterList } from './components/JobDeadLetterList'
import { JobDeadLettersToolbar } from './components/JobDeadLettersToolbar'
import { JobDeadLettersPagination } from './components/JobDeadLettersPagination'
import { DEFAULT_PER_PAGE, SEARCH_PARAMS } from './types'

export const metadata: Metadata = {
  title: 'Job dead letters | GP Admin',
  description: 'See jobs that exhausted their retries and put one back',
}

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const firstValue = (
  value: string | string[] | undefined
): string | undefined => (Array.isArray(value) ? value[0] : value)

export default async function Page({ searchParams }: PageProps) {
  const { has, orgId } = await auth()

  if (!has?.({ role: ROLES.ADMIN }) || !orgId) {
    redirect('/dashboard/users')
  }

  const params = await searchParams

  const pageParam = Number(firstValue(params[SEARCH_PARAMS.PAGE]))
  const currentPage =
    Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1

  const sourceQueue = firstValue(params[SEARCH_PARAMS.SOURCE_QUEUE])

  const [queues, result] = await Promise.all([
    listJobDeadLetterQueues(),
    listJobDeadLetters({
      offset: (currentPage - 1) * DEFAULT_PER_PAGE,
      limit: DEFAULT_PER_PAGE,
      ...(sourceQueue ? { sourceQueue } : {}),
    }),
  ])

  return (
    <Container size="4">
      <Heading size="6" mb="1">
        Job dead letters
      </Heading>
      <Text color="gray" size="2" as="p" mb="4">
        Jobs that used every retry. Re-driving one puts it back on the queue it
        failed on with its attempts reset, so fix the cause first.
      </Text>

      <Box mb="6">
        <JobDeadLettersToolbar sourceQueue={sourceQueue} queues={queues} />
      </Box>

      <JobDeadLetterList deadLetters={result.data} />

      <JobDeadLettersPagination meta={result.meta} currentPage={currentPage} />
    </Container>
  )
}
