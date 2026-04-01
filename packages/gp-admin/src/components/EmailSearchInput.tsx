'use client'

import { UseFormRegisterReturn } from 'react-hook-form'
import { TextField, Box, Text } from '@radix-ui/themes'
import { HiSearch } from 'react-icons/hi'

interface EmailSearchInputProps {
  registration: UseFormRegisterReturn
}

export function EmailSearchInput({ registration }: EmailSearchInputProps) {
  return (
    <Box style={{ maxWidth: '400px' }}>
      <Text as="label" size="2" weight="medium" mb="1">
        Email
      </Text>
      <TextField.Root placeholder="Enter email address..." {...registration}>
        <TextField.Slot>
          <HiSearch className="w-4 h-4" />
        </TextField.Slot>
      </TextField.Root>
    </Box>
  )
}
