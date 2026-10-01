'use client'

import { Box, Card, Flex, Grid, Heading, Text } from '@radix-ui/themes'
import type {
  TenDlcStatusBucket,
  TenDlcStatusBucketKey,
} from '@goodparty_org/sdk'
import {
  BUCKET_META,
  STUCK_BUCKET_KEYS,
  TONE_FILL,
  TONE_LABEL,
  type BucketMeta,
} from '../bucketMeta'

interface SummaryDashboardProps {
  buckets: TenDlcStatusBucket[]
  activeBucket: TenDlcStatusBucketKey | null
  onSelectBucket: (key: TenDlcStatusBucketKey | null) => void
}

const TONES: BucketMeta['tone'][] = ['red', 'amber', 'gray']

function ToneDot({ tone }: { tone: BucketMeta['tone'] }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: '50%',
        backgroundColor: TONE_FILL[tone],
        flexShrink: 0,
      }}
    />
  )
}

function StatTile({
  label,
  value,
  tone,
  sub,
}: {
  label: string
  value: number
  tone?: BucketMeta['tone']
  sub?: string
}) {
  return (
    <Card role="group" aria-label={label}>
      <Flex align="center" gap="2">
        {tone && <ToneDot tone={tone} />}
        <Text size="1" color="gray">
          {label}
        </Text>
      </Flex>
      <Text as="div" size="8" weight="bold" mt="1">
        {value}
      </Text>
      {sub && (
        <Text as="div" size="1" color="gray" mt="1">
          {sub}
        </Text>
      )}
    </Card>
  )
}

export function SummaryDashboard({
  buckets,
  activeBucket,
  onSelectBucket,
}: SummaryDashboardProps) {
  const counts = buckets.map((bucket) => ({
    key: bucket.key,
    count: bucket.entries.length,
    meta: BUCKET_META[bucket.key],
  }))
  const total = counts.reduce((sum, row) => sum + row.count, 0)
  const toneTotals = TONES.map((tone) => ({
    tone,
    count: counts
      .filter((row) => row.meta.tone === tone)
      .reduce((sum, row) => sum + row.count, 0),
  }))
  const stuckTotal = counts
    .filter((row) => STUCK_BUCKET_KEYS.includes(row.key))
    .reduce((sum, row) => sum + row.count, 0)
  const populated = counts.filter((row) => row.count > 0)
  const maxCount = Math.max(1, ...populated.map((row) => row.count))

  return (
    <Flex direction="column" gap="3" mb="4">
      <Grid columns={{ initial: '2', sm: '4' }} gap="3">
        <StatTile
          label="Stuck now"
          value={stuckTotal}
          sub="matches the nightly report header"
        />
        {toneTotals.map(({ tone, count }) => (
          <StatTile
            key={tone}
            label={TONE_LABEL[tone]}
            value={count}
            tone={tone}
          />
        ))}
      </Grid>

      {total > 0 && (
        <Card>
          <Heading size="2" mb="2">
            Where registrations sit
          </Heading>
          <Flex
            align="center"
            style={{ gap: 2, borderRadius: 4, overflow: 'hidden', height: 12 }}
            aria-hidden
          >
            {toneTotals
              .filter(({ count }) => count > 0)
              .map(({ tone, count }) => (
                <Box
                  key={tone}
                  style={{
                    width: `${(count / total) * 100}%`,
                    height: '100%',
                    backgroundColor: TONE_FILL[tone],
                  }}
                />
              ))}
          </Flex>
          <Flex gap="4" mt="2" wrap="wrap">
            {toneTotals.map(({ tone, count }) => (
              <Flex key={tone} align="center" gap="2">
                <ToneDot tone={tone} />
                <Text size="1" color="gray">
                  {TONE_LABEL[tone]}: {count}
                </Text>
              </Flex>
            ))}
          </Flex>

          <Heading size="2" mt="4" mb="2">
            By bucket — click a bar to filter
          </Heading>
          <Flex direction="column" gap="1">
            {populated.map(({ key, count, meta }) => {
              const active = activeBucket === key
              const dimmed = activeBucket !== null && !active
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelectBucket(active ? null : key)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(180px, 280px) 1fr',
                    alignItems: 'center',
                    gap: 12,
                    background: 'none',
                    border: 'none',
                    padding: '2px 0',
                    cursor: 'pointer',
                    textAlign: 'left',
                    opacity: dimmed ? 0.4 : 1,
                  }}
                >
                  <Text
                    size="1"
                    color="gray"
                    truncate
                    style={{
                      textDecoration: active ? 'underline' : 'none',
                    }}
                  >
                    {meta.label}
                  </Text>
                  <Flex align="center" gap="2">
                    <Box
                      style={{
                        width: `${(count / maxCount) * 100}%`,
                        maxWidth: 'calc(100% - 32px)',
                        height: 14,
                        borderRadius: '0 4px 4px 0',
                        backgroundColor: TONE_FILL[meta.tone],
                      }}
                    />
                    <Text size="1" weight="medium">
                      {count}
                    </Text>
                  </Flex>
                </button>
              )
            })}
          </Flex>
        </Card>
      )}
    </Flex>
  )
}
