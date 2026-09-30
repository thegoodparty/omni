'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Container, Flex, Heading, Text } from '@radix-ui/themes'
import { HiRefresh } from 'react-icons/hi'
import { format, parseISO } from 'date-fns'
import type { TenDlcStatusSnapshot } from '@goodparty_org/sdk'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { describeActionFailure } from '@/shared/util/actionFailure.util'
import { getTenDlcStatusSnapshot } from '../actions'
import { BUCKET_META, STUCK_BUCKET_KEYS } from '../bucketMeta'
import { BucketSection } from './BucketSection'

export function TenDlcStatusPage() {
  const [snapshot, setSnapshot] = useState<TenDlcStatusSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSnapshot(await getTenDlcStatusSnapshot())
    } catch (err) {
      setError(describeActionFailure(err, 'Failed to load the 10DLC status'))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const stuckCount =
    snapshot?.buckets.reduce(
      (sum, bucket) =>
        STUCK_BUCKET_KEYS.includes(bucket.key)
          ? sum + bucket.entries.length
          : sum,
      0
    ) ?? 0
  const populated =
    snapshot?.buckets.filter((bucket) => bucket.entries.length > 0) ?? []

  return (
    <Container size="4">
      <Flex justify="between" align="center" mb="2" wrap="wrap" gap="2">
        <Heading size="6">10DLC Status</Heading>
        <Button variant="outline" onClick={load} disabled={loading}>
          <HiRefresh className="w-4 h-4" />
          Refresh
        </Button>
      </Flex>
      <Text as="p" size="2" color="gray" mb="4">
        Every stuck 10DLC registration, in the same buckets as the nightly
        report. The domain sweep runs live, so a refresh can take a few seconds.
      </Text>

      {loading && <LoadingSpinner />}
      {!loading && error && (
        <Text as="p" size="2" color="red">
          {error}
        </Text>
      )}

      {!loading && !error && snapshot && (
        <>
          <Flex gap="2" mb="4" wrap="wrap" align="center">
            <Badge color={stuckCount > 0 ? 'red' : 'green'} size="2">
              {stuckCount > 0 ? `${stuckCount} stuck` : 'No campaigns stuck'}
            </Badge>
            {populated.map((bucket) => (
              <Badge key={bucket.key} color={BUCKET_META[bucket.key].tone}>
                {BUCKET_META[bucket.key].label}: {bucket.entries.length}
              </Badge>
            ))}
            <Text size="1" color="gray">
              Generated{' '}
              {format(parseISO(snapshot.generatedAt), 'MMM d, yyyy h:mm a')}
            </Text>
          </Flex>

          {populated.length === 0 && (
            <Text as="p" size="2" color="gray">
              Every registration is moving. Nothing to triage.
            </Text>
          )}
          {populated.map((bucket) => (
            <BucketSection key={bucket.key} bucket={bucket} />
          ))}
        </>
      )}
    </Container>
  )
}
