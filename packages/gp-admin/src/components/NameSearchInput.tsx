'use client'

import { UseFormRegisterReturn } from 'react-hook-form'
import { TextField, Flex, Box, Text } from '@radix-ui/themes'
import { HiSearch } from 'react-icons/hi'

interface NameSearchInputProps {
  firstNameRegistration: UseFormRegisterReturn
  lastNameRegistration: UseFormRegisterReturn
}

export function NameSearchInput({
  firstNameRegistration,
  lastNameRegistration,
}: NameSearchInputProps) {
  return (
    <Flex gap="4" wrap="wrap">
      <Box flexGrow="1" style={{ minWidth: '180px' }}>
        <Text as="label" size="2" weight="medium" mb="1">
          First Name
        </Text>
        <TextField.Root
          placeholder="Enter first name..."
          {...firstNameRegistration}
        >
          <TextField.Slot>
            <HiSearch className="w-4 h-4" />
          </TextField.Slot>
        </TextField.Root>
      </Box>

      <Box flexGrow="1" style={{ minWidth: '180px' }}>
        <Text as="label" size="2" weight="medium" mb="1">
          Last Name
        </Text>
        <TextField.Root
          placeholder="Enter last name..."
          {...lastNameRegistration}
        >
          <TextField.Slot>
            <HiSearch className="w-4 h-4" />
          </TextField.Slot>
        </TextField.Root>
      </Box>
    </Flex>
  )
}
