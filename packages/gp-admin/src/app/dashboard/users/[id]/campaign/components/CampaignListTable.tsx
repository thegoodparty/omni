import Link from 'next/link'
import { Table, Text, Badge } from '@radix-ui/themes'
import type { Campaign } from '@goodparty_org/sdk'
import { OTHER_OFFICE } from '../../constants'

interface CampaignListTableProps {
  campaigns: Campaign[]
  basePath: string
}

function resolvedOffice(
  office: string | undefined,
  otherOffice: string | undefined
) {
  if (office === OTHER_OFFICE && otherOffice) {
    return otherOffice
  }
  return office ?? '—'
}

export function CampaignListTable({
  campaigns,
  basePath,
}: CampaignListTableProps) {
  if (campaigns.length === 0) {
    return (
      <Text color="gray" size="3">
        No campaigns found for this user.
      </Text>
    )
  }

  return (
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell>ID</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Campaign</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Office</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Tier</Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {campaigns.map((campaign) => (
          <Table.Row key={campaign.id}>
            <Table.Cell>{campaign.id}</Table.Cell>
            <Table.Cell>
              <Link
                href={`${basePath}/${campaign.id}`}
                className="text-[var(--accent-11)] hover:underline"
              >
                {campaign.data?.name || `Campaign #${campaign.id}`}
              </Link>
            </Table.Cell>
            <Table.Cell>
              {resolvedOffice(
                campaign.details?.office,
                campaign.details?.otherOffice
              )}
            </Table.Cell>
            <Table.Cell>
              <Badge
                color={campaign.isActive ? 'green' : 'gray'}
                variant="soft"
              >
                {campaign.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </Table.Cell>
            <Table.Cell>{campaign.tier ?? '—'}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  )
}
