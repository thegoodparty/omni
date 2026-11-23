import { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { Box, Code, DataList, Flex, Heading, Text } from '@radix-ui/themes'
import type { JobDeadLetter } from '@goodparty_org/contracts'
import { ROLES } from '@/lib/permissions'
import { SdkError } from '@/shared/gpApi'
import { getJobDeadLetter } from '../actions'
import { DeleteDeadLetterButton } from '../components/DeleteDeadLetterButton'
import { RedriveDeadLetterButton } from '../components/RedriveDeadLetterButton'

export const metadata: Metadata = {
  title: 'Job dead letter | GP Admin',
  description: 'Read one dead-lettered job and put it back on its queue',
}

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function Page({ params }: PageProps) {
  const { has, orgId } = await auth()

  if (!has?.({ role: ROLES.ADMIN }) || !orgId) {
    redirect('/dashboard/users')
  }

  const { id } = await params

  let deadLetter: JobDeadLetter
  try {
    deadLetter = await getJobDeadLetter(id)
  } catch (error) {
    if (error instanceof SdkError && error.status === 404) {
      notFound()
    }
    throw error
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/dashboard/job-dead-letters"
          className="text-[var(--accent-11)] hover:underline text-sm"
        >
          ← All dead letters
        </Link>
        <Flex align="center" justify="between" mt="2" gap="3">
          <div>
            <Heading size="6">{deadLetter.id}</Heading>
            <Text color="gray" size="2">
              {deadLetter.sourceQueue ?? 'No source queue'}
            </Text>
          </div>
          <Flex gap="2">
            <RedriveDeadLetterButton deadLetter={deadLetter} size="2" />
            <DeleteDeadLetterButton deadLetter={deadLetter} size="2" />
          </Flex>
        </Flex>
      </div>

      <Box p="4" className="border border-[var(--gray-5)] rounded-lg">
        <DataList.Root>
          <DataList.Item>
            <DataList.Label>Job id</DataList.Label>
            <DataList.Value>
              <Code variant="ghost" size="1">
                {deadLetter.id}
              </Code>
            </DataList.Value>
          </DataList.Item>
          <DataList.Item>
            <DataList.Label>Source queue</DataList.Label>
            <DataList.Value>
              {deadLetter.sourceQueue ?? (
                <Text color="amber">
                  None recorded, so this one can only be read
                </Text>
              )}
            </DataList.Value>
          </DataList.Item>
          <DataList.Item>
            <DataList.Label>Died</DataList.Label>
            <DataList.Value>
              {new Date(deadLetter.createdAt).toLocaleString('en-US', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </DataList.Value>
          </DataList.Item>
          <DataList.Item>
            <DataList.Label>Retries used</DataList.Label>
            <DataList.Value>{deadLetter.retriesUsed ?? '—'}</DataList.Value>
          </DataList.Item>
          <DataList.Item>
            <DataList.Label>Last error</DataList.Label>
            <DataList.Value>
              {deadLetter.error ? (
                <Text color="red">{deadLetter.error}</Text>
              ) : (
                '—'
              )}
            </DataList.Value>
          </DataList.Item>
        </DataList.Root>
      </Box>

      <Box>
        <Heading size="3" mb="2">
          Payload
        </Heading>
        <pre className="bg-[var(--gray-2)] rounded-md p-3 overflow-auto">
          <Code variant="ghost" size="1">
            {JSON.stringify(deadLetter.data, null, 2)}
          </Code>
        </pre>
      </Box>
    </div>
  )
}
