'use client'

import { useState } from 'react'
import { Container, Flex, Box, Tabs, Separator } from '@radix-ui/themes'
import { UserProvider } from '../UserProvider'
import {
  DETAIL_TABS,
  DETAIL_TAB_VALUES,
  type DetailTabValue,
} from '../constants'
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

function isTabValue(value: string): value is DetailTabValue {
  return DETAIL_TAB_VALUES.includes(value as DetailTabValue)
}

export default function UserDetailPage({ user }: UserDetailPageProps) {
  const [activeTab, setActiveTab] = useState<DetailTabValue>(DETAIL_TABS.USER)

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
            <Tabs.Trigger value={DETAIL_TABS.USER}>User</Tabs.Trigger>
            <Tabs.Trigger value={DETAIL_TABS.CAMPAIGN}>Campaign</Tabs.Trigger>
            <Tabs.Trigger value={DETAIL_TABS.P2V}>Path to Victory</Tabs.Trigger>
            <Tabs.Trigger value={DETAIL_TABS.ELECTED_OFFICE}>
              Elected Office
            </Tabs.Trigger>
            <Tabs.Trigger value={DETAIL_TABS.CONTENT}>Content</Tabs.Trigger>
            <Tabs.Trigger value={DETAIL_TABS.INTEGRATIONS}>
              Integrations
            </Tabs.Trigger>
          </Tabs.List>

          <Box pt="4">
            <Tabs.Content value={DETAIL_TABS.USER}>
              <Flex direction="column" gap="6">
                <UserInfoSection />
              </Flex>
            </Tabs.Content>

            <Tabs.Content value={DETAIL_TABS.CAMPAIGN}>
              <Flex direction="column" gap="6">
                <CampaignStatusSection />
                <CampaignDetailsDisplaySection />
                <TopIssuesSection />
                <CampaignPlanStatusSection />
                <CustomVoterFilesSection />
              </Flex>
            </Tabs.Content>

            <Tabs.Content value={DETAIL_TABS.P2V}>
              <Flex direction="column" gap="6">
                <PathToVictoryDisplaySection />
                <VoterOutreachSection />
              </Flex>
            </Tabs.Content>

            <Tabs.Content value={DETAIL_TABS.ELECTED_OFFICE}>
              <Flex direction="column" gap="6">
                <ElectedOfficeSection />
              </Flex>
            </Tabs.Content>

            <Tabs.Content value={DETAIL_TABS.CONTENT}>
              <Flex direction="column" gap="6">
                <AIContentSection />
              </Flex>
            </Tabs.Content>

            <Tabs.Content value={DETAIL_TABS.INTEGRATIONS}>
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
