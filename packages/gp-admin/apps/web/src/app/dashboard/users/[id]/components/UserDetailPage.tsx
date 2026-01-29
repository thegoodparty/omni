'use client'

import { useState } from 'react'
import { Container, Flex, Box, Tabs, Separator } from '@radix-ui/themes'
import { UserHeader } from './UserHeader'
import { UserBasicInfoSection } from './UserBasicInfoSection'
import { CampaignDetailsSection } from './CampaignDetailsSection'
import { PathToVictorySection } from './PathToVictorySection'
import { VoterOutreachSection } from './VoterOutreachSection'
import { TopIssuesSection } from './TopIssuesSection'
import { CampaignPlanStatusSection } from './CampaignPlanStatusSection'
import { CustomVoterFilesSection } from './CustomVoterFilesSection'
import { AIContentSection } from './AIContentSection'
import { HubSpotSection } from './HubSpotSection'
import type { DetailedUser } from '../types'

interface UserDetailPageProps {
  user: DetailedUser
}

type TabValue = 'overview' | 'campaign' | 'p2v' | 'content' | 'integrations'

export default function UserDetailPage({ user }: UserDetailPageProps) {
  const [activeTab, setActiveTab] = useState<TabValue>('overview')

  return (
    <Container size="4">
      <Box mb="6">
        <UserHeader user={user} />
      </Box>

      <Separator size="4" mb="6" />

      <Tabs.Root
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as TabValue)}
      >
        <Tabs.List mb="4">
          <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
          <Tabs.Trigger value="campaign">Campaign</Tabs.Trigger>
          <Tabs.Trigger value="p2v">Path to Victory</Tabs.Trigger>
          <Tabs.Trigger value="content">Content</Tabs.Trigger>
          <Tabs.Trigger value="integrations">Integrations</Tabs.Trigger>
        </Tabs.List>

        <Box pt="4">
          <Tabs.Content value="overview">
            <Flex direction="column" gap="6">
              <UserBasicInfoSection user={user} />
            </Flex>
          </Tabs.Content>

          <Tabs.Content value="campaign">
            <Flex direction="column" gap="6">
              <CampaignDetailsSection user={user} />
              <TopIssuesSection user={user} />
              <CampaignPlanStatusSection user={user} />
              <CustomVoterFilesSection user={user} />
            </Flex>
          </Tabs.Content>

          <Tabs.Content value="p2v">
            <Flex direction="column" gap="6">
              <PathToVictorySection user={user} />
              <VoterOutreachSection user={user} />
            </Flex>
          </Tabs.Content>

          <Tabs.Content value="content">
            <Flex direction="column" gap="6">
              <AIContentSection user={user} />
            </Flex>
          </Tabs.Content>

          <Tabs.Content value="integrations">
            <Flex direction="column" gap="6">
              <HubSpotSection user={user} />
            </Flex>
          </Tabs.Content>
        </Box>
      </Tabs.Root>
    </Container>
  )
}
