'use client'

import { Button, Flex, Box, Text, SegmentedControl } from '@radix-ui/themes'
import { HiX } from 'react-icons/hi'
import {
  useUserSearch,
  SEARCH_TAB,
  type ProFilter,
} from '@/lib/hooks/useUserSearch'
import { EmailSearchInput } from './EmailSearchInput'
import { NameSearchInput } from './NameSearchInput'

export function UserSearchForm() {
  const {
    activeTab,
    handleTabChange,
    register,
    handleSubmit,
    onSubmit,
    handleClear,
    showClear,
    proFilter,
    setProFilter,
  } = useUserSearch()

  return (
    <Box asChild p="4" className="border border-[var(--gray-5)] rounded-lg">
      <form autoComplete="off" onSubmit={handleSubmit(onSubmit)}>
        <Flex direction="column" gap="4">
          <Flex align="center" justify="between" gap="2">
            <Box>
              <Text as="label" size="2" weight="medium" mb="2" mr="2">
                Search by
              </Text>
              <SegmentedControl.Root
                value={activeTab}
                onValueChange={handleTabChange}
              >
                <SegmentedControl.Item value={SEARCH_TAB.EMAIL}>
                  Email
                </SegmentedControl.Item>
                <SegmentedControl.Item value={SEARCH_TAB.NAME}>
                  Name
                </SegmentedControl.Item>
              </SegmentedControl.Root>
            </Box>

            {showClear && (
              <Button
                type="button"
                variant="soft"
                color="gray"
                onClick={handleClear}
              >
                <HiX className="w-4 h-4" />
                Clear
              </Button>
            )}
          </Flex>

          {activeTab === SEARCH_TAB.EMAIL ? (
            <EmailSearchInput registration={register('email')} />
          ) : (
            <NameSearchInput
              firstNameRegistration={register('firstName')}
              lastNameRegistration={register('lastName')}
            />
          )}

          <Box>
            <Text as="label" size="2" weight="medium" mb="2" mr="2">
              Pro status
            </Text>
            <SegmentedControl.Root
              value={proFilter}
              onValueChange={(v) => setProFilter(v as ProFilter)}
            >
              <SegmentedControl.Item value="all">All</SegmentedControl.Item>
              <SegmentedControl.Item value="pro">Pro</SegmentedControl.Item>
              <SegmentedControl.Item value="not_pro">
                Not Pro
              </SegmentedControl.Item>
            </SegmentedControl.Root>
          </Box>
        </Flex>
      </form>
    </Box>
  )
}
