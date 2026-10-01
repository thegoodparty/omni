'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Container,
  Flex,
  Heading,
  Select,
  Text,
  TextField,
} from '@radix-ui/themes'
import { HiOutlineSearch, HiRefresh } from 'react-icons/hi'
import { format, parseISO } from 'date-fns'
import type {
  TenDlcStatusBucketKey,
  TenDlcStatusEntry,
  TenDlcStatusSnapshot,
} from '@goodparty_org/sdk'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { describeActionFailure } from '@/shared/util/actionFailure.util'
import { getTenDlcStatusSnapshot } from '../actions'
import { BUCKET_META } from '../bucketMeta'
import { BucketSection } from './BucketSection'
import { SummaryDashboard } from './SummaryDashboard'

const matchesSearch = (entry: TenDlcStatusEntry, needle: string): boolean =>
  entry.campaignSlug.toLowerCase().includes(needle) ||
  (entry.committeeName?.toLowerCase().includes(needle) ?? false)

export function TenDlcStatusPage() {
  const [snapshot, setSnapshot] = useState<TenDlcStatusSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [bucketFilter, setBucketFilter] =
    useState<TenDlcStatusBucketKey | null>(null)
  const [search, setSearch] = useState('')

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

  const needle = search.trim().toLowerCase()
  const filtersActive = bucketFilter !== null || needle !== ''
  const populated =
    snapshot?.buckets.filter((bucket) => bucket.entries.length > 0) ?? []
  const totalCount = populated.reduce(
    (sum, bucket) => sum + bucket.entries.length,
    0
  )
  const visible = populated
    .filter((bucket) => bucketFilter === null || bucket.key === bucketFilter)
    .map((bucket) =>
      needle === ''
        ? bucket
        : {
            ...bucket,
            entries: bucket.entries.filter((entry) =>
              matchesSearch(entry, needle)
            ),
          }
    )
    .filter((bucket) => bucket.entries.length > 0)
  const shownCount = visible.reduce(
    (sum, bucket) => sum + bucket.entries.length,
    0
  )

  const clearFilters = () => {
    setBucketFilter(null)
    setSearch('')
  }

  return (
    <Container size="4">
      <Flex justify="between" align="center" mb="2" wrap="wrap" gap="2">
        <Heading size="6">10DLC Status</Heading>
        <Flex align="center" gap="3">
          {snapshot && (
            <Text size="1" color="gray">
              Generated{' '}
              {format(parseISO(snapshot.generatedAt), 'MMM d, yyyy h:mm a')}
            </Text>
          )}
          <Button variant="outline" onClick={load} disabled={loading}>
            <HiRefresh className="w-4 h-4" />
            Refresh
          </Button>
        </Flex>
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
          <SummaryDashboard
            buckets={snapshot.buckets}
            activeBucket={bucketFilter}
            onSelectBucket={setBucketFilter}
          />

          {totalCount === 0 && (
            <Text as="p" size="2" color="gray">
              Every registration is moving. Nothing to triage.
            </Text>
          )}

          {totalCount > 0 && (
            <>
              <Flex gap="2" mb="4" align="center" wrap="wrap">
                <TextField.Root
                  placeholder="Search candidate, campaign, or committee"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  style={{ minWidth: 280 }}
                >
                  <TextField.Slot>
                    <HiOutlineSearch />
                  </TextField.Slot>
                </TextField.Root>
                <Select.Root
                  value={bucketFilter ?? 'all'}
                  onValueChange={(value) =>
                    setBucketFilter(
                      value === 'all' ? null : (value as TenDlcStatusBucketKey)
                    )
                  }
                >
                  <Select.Trigger aria-label="Bucket filter" />
                  <Select.Content>
                    <Select.Item value="all">All buckets</Select.Item>
                    {populated.map((bucket) => (
                      <Select.Item key={bucket.key} value={bucket.key}>
                        {BUCKET_META[bucket.key].label} ({bucket.entries.length}
                        )
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
                {filtersActive && (
                  <>
                    <Button variant="ghost" onClick={clearFilters}>
                      Clear filters
                    </Button>
                    <Text size="1" color="gray">
                      Showing {shownCount} of {totalCount} registrations
                    </Text>
                  </>
                )}
              </Flex>

              {visible.length === 0 && (
                <Text as="p" size="2" color="gray">
                  No registrations match these filters.
                </Text>
              )}
              {visible.map((bucket) => (
                <BucketSection key={bucket.key} bucket={bucket} />
              ))}
            </>
          )}
        </>
      )}
    </Container>
  )
}
