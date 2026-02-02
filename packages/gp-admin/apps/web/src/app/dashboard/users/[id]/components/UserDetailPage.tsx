'use client'

import { useState } from 'react'
import { Container, Flex, Box, Tabs, Separator } from '@radix-ui/themes'
import { UserProvider } from '../UserProvider'
import { UserHeader } from './UserHeader'
import { UserInfoSection } from './UserInfoSection'
import { CampaignStatusSection } from './CampaignStatusSection'
import { CampaignDetailsDisplaySection } from './CampaignDetailsDisplaySection'
import { PathToVictoryDisplaySection } from './PathToVictoryDisplaySection'
import { ElectedOfficeSection } from './ElectedOfficeSection'
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

const TAB_VALUES = [
  'user',
  'campaign',
  'p2v',
  'elected-office',
  'content',
  'integrations',
] as const

type TabValue = (typeof TAB_VALUES)[number]

function isTabValue(value: string): value is TabValue {
  return TAB_VALUES.includes(value as TabValue)
}

export default function UserDetailPage({ user }: UserDetailPageProps) {
  const [activeTab, setActiveTab] = useState<TabValue>('user')

  function handleTabChange(value: string) {
    if (isTabValue(value)) {
      setActiveTab(value)
    }
  }

  return (
    <UserProvider user={user}>
      <Container size="4">
        <Box mb="6">
          <UserHeader />
        </Box>

        <Separator size="4" mb="6" />

        <Tabs.Root value={activeTab} onValueChange={handleTabChange}>
          <Tabs.List mb="4">
            <Tabs.Trigger value="user">User</Tabs.Trigger>
            <Tabs.Trigger value="campaign">Campaign</Tabs.Trigger>
            <Tabs.Trigger value="p2v">Path to Victory</Tabs.Trigger>
            <Tabs.Trigger value="elected-office">Elected Office</Tabs.Trigger>
            <Tabs.Trigger value="content">Content</Tabs.Trigger>
            <Tabs.Trigger value="integrations">Integrations</Tabs.Trigger>
          </Tabs.List>

          <Box pt="4">
            <Tabs.Content value="user">
              <Flex direction="column" gap="6">
                <UserInfoSection />
              </Flex>
            </Tabs.Content>

            <Tabs.Content value="campaign">
              <Flex direction="column" gap="6">
                <CampaignStatusSection />
                <CampaignDetailsDisplaySection />
                <TopIssuesSection />
                <CampaignPlanStatusSection />
                <CustomVoterFilesSection />
              </Flex>
            </Tabs.Content>

            <Tabs.Content value="p2v">
              <Flex direction="column" gap="6">
                <PathToVictoryDisplaySection />
                <VoterOutreachSection />
              </Flex>
            </Tabs.Content>

            <Tabs.Content value="elected-office">
              <Flex direction="column" gap="6">
                <ElectedOfficeSection />
              </Flex>
            </Tabs.Content>

            <Tabs.Content value="content">
              <Flex direction="column" gap="6">
                <AIContentSection />
              </Flex>
            </Tabs.Content>

            <Tabs.Content value="integrations">
              <Flex direction="column" gap="6">
                <HubSpotSection />
              </Flex>
            </Tabs.Content>
          </Box>
        </Tabs.Root>
      </Container>
    </UserProvider>
  )
}
