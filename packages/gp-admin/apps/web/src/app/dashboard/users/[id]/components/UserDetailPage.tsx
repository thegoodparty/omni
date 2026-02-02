'use client'

import { useState } from 'react'
import { Container, Flex, Box, Tabs, Separator } from '@radix-ui/themes'
import { UserProvider } from '../UserProvider'
import { TABS, TAB_VALUES, type TabValue } from '../constants'
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

function isTabValue(value: string): value is TabValue {
  return TAB_VALUES.includes(value as TabValue)
}

export default function UserDetailPage({ user }: UserDetailPageProps) {
  const [activeTab, setActiveTab] = useState<TabValue>(TABS.USER)

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
            <Tabs.Trigger value={TABS.USER}>User</Tabs.Trigger>
            <Tabs.Trigger value={TABS.CAMPAIGN}>Campaign</Tabs.Trigger>
            <Tabs.Trigger value={TABS.P2V}>Path to Victory</Tabs.Trigger>
            <Tabs.Trigger value={TABS.ELECTED_OFFICE}>
              Elected Office
            </Tabs.Trigger>
            <Tabs.Trigger value={TABS.CONTENT}>Content</Tabs.Trigger>
            <Tabs.Trigger value={TABS.INTEGRATIONS}>Integrations</Tabs.Trigger>
          </Tabs.List>

          <Box pt="4">
            <Tabs.Content value={TABS.USER}>
              <Flex direction="column" gap="6">
                <UserInfoSection />
              </Flex>
            </Tabs.Content>

            <Tabs.Content value={TABS.CAMPAIGN}>
              <Flex direction="column" gap="6">
                <CampaignStatusSection />
                <CampaignDetailsDisplaySection />
                <TopIssuesSection />
                <CampaignPlanStatusSection />
                <CustomVoterFilesSection />
              </Flex>
            </Tabs.Content>

            <Tabs.Content value={TABS.P2V}>
              <Flex direction="column" gap="6">
                <PathToVictoryDisplaySection />
                <VoterOutreachSection />
              </Flex>
            </Tabs.Content>

            <Tabs.Content value={TABS.ELECTED_OFFICE}>
              <Flex direction="column" gap="6">
                <ElectedOfficeSection />
              </Flex>
            </Tabs.Content>

            <Tabs.Content value={TABS.CONTENT}>
              <Flex direction="column" gap="6">
                <AIContentSection />
              </Flex>
            </Tabs.Content>

            <Tabs.Content value={TABS.INTEGRATIONS}>
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
