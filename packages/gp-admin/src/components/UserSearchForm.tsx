'use client'

import { Button, Flex, Box, Text, SegmentedControl } from '@radix-ui/themes'
import { HiX } from 'react-icons/hi'
import { useUserSearch, SEARCH_TAB } from '@/lib/hooks/useUserSearch'
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
  } = useUserSearch()

  return (
    <Box asChild p="4" className="border border-[var(--gray-5)] rounded-lg">
      <form onSubmit={handleSubmit(onSubmit)}>
        <Flex direction="column" gap="4">
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

          {activeTab === SEARCH_TAB.EMAIL ? (
            <EmailSearchInput registration={register('email')} />
          ) : (
            <NameSearchInput
              firstNameRegistration={register('firstName')}
              lastNameRegistration={register('lastName')}
            />
          )}

          <Flex gap="2" justify="end">
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
        </Flex>
      </form>
    </Box>
  )
}
